// Svitlo backend — роздає зібраний фронт (dist) і надає auth-API.
// БД: Postgres (DATABASE_URL). Логін: телефон + пароль (bcrypt), сесія — JWT.
import express from 'express'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import webpush from 'web-push'
import path from 'path'
import http from 'http'
import { WebSocketServer } from 'ws'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const isLocal = (process.env.DATABASE_URL || '').includes('localhost')

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
})

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      rider_profile JSONB,
      driver_profile JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subs (
      user_id INTEGER PRIMARY KEY,
      subscription JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `)
}

// Web Push (VAPID). Якщо ключі не задані — пуші просто вимкнені.
const PUSH_ON = !!(process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE)
if (PUSH_ON) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@svitlo.app',
    process.env.VAPID_PUBLIC,
    process.env.VAPID_PRIVATE
  )
}

// Надіслати пуш користувачу (за user_id). Чистить мертві підписки.
async function pushToUser(userId, payload) {
  if (!PUSH_ON || !userId) return
  try {
    const r = await pool.query('SELECT subscription FROM push_subs WHERE user_id=$1', [userId])
    if (!r.rowCount) return
    await webpush.sendNotification(r.rows[0].subscription, JSON.stringify(payload))
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      await pool.query('DELETE FROM push_subs WHERE user_id=$1', [userId]).catch(() => {})
    }
  }
}

const app = express()
app.use(express.json())

const normPhone = (p) => (p || '').replace(/[^\d+]/g, '')
const sign = (u) => jwt.sign({ id: u.id, phone: u.phone }, JWT_SECRET, { expiresIn: '30d' })
const publicUser = (u) => ({
  phone: u.phone,
  profiles: { rider: u.rider_profile || null, driver: u.driver_profile || null },
})

function auth(req, res, next) {
  const h = req.headers.authorization || ''
  const t = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!t) return res.status(401).json({ error: 'Не авторизовано' })
  try {
    req.user = jwt.verify(t, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Сесія недійсна' })
  }
}

// Реєстрація: телефон+пароль+перший профіль (rider або driver).
app.post('/api/register', async (req, res) => {
  try {
    const phone = normPhone(req.body.phone)
    const { password, role, profile } = req.body
    if (phone.length < 7 || !password || password.length < 4)
      return res.status(400).json({ error: 'Вкажіть номер і пароль (мін. 4 символи)' })
    if (!['rider', 'driver'].includes(role) || !profile)
      return res.status(400).json({ error: 'Невірні дані профілю' })

    const exists = await pool.query('SELECT id FROM users WHERE phone=$1', [phone])
    if (exists.rowCount)
      return res.status(409).json({ error: 'Цей номер вже зареєстрований — увійдіть' })

    const hash = await bcrypt.hash(password, 10)
    const col = role === 'driver' ? 'driver_profile' : 'rider_profile'
    const r = await pool.query(
      `INSERT INTO users (phone, password_hash, ${col}) VALUES ($1,$2,$3) RETURNING *`,
      [phone, hash, profile]
    )
    const u = r.rows[0]
    res.json({ token: sign(u), user: publicUser(u) })
  } catch (e) {
    console.error('register', e)
    res.status(500).json({ error: 'Помилка сервера' })
  }
})

// Вхід: телефон + пароль.
app.post('/api/login', async (req, res) => {
  try {
    const phone = normPhone(req.body.phone)
    const r = await pool.query('SELECT * FROM users WHERE phone=$1', [phone])
    if (!r.rowCount) return res.status(404).json({ error: 'Номер не знайдено' })
    const u = r.rows[0]
    const ok = await bcrypt.compare(req.body.password || '', u.password_hash)
    if (!ok) return res.status(401).json({ error: 'Невірний пароль' })
    res.json({ token: sign(u), user: publicUser(u) })
  } catch (e) {
    console.error('login', e)
    res.status(500).json({ error: 'Помилка сервера' })
  }
})

// Поточний користувач за токеном.
app.get('/api/me', auth, async (req, res) => {
  const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id])
  if (!r.rowCount) return res.status(404).json({ error: 'Користувача не знайдено' })
  res.json({ user: publicUser(r.rows[0]) })
})

// Оновити/додати профіль ролі (наприклад, зареєстрований пасажир додає профіль водія).
app.put('/api/profile', auth, async (req, res) => {
  const { role, profile } = req.body
  if (!['rider', 'driver'].includes(role) || !profile)
    return res.status(400).json({ error: 'Невірні дані' })
  const col = role === 'driver' ? 'driver_profile' : 'rider_profile'
  const r = await pool.query(`UPDATE users SET ${col}=$1 WHERE id=$2 RETURNING *`, [
    profile,
    req.user.id,
  ])
  if (!r.rowCount) return res.status(404).json({ error: 'Користувача не знайдено' })
  res.json({ user: publicUser(r.rows[0]) })
})

// Публічний VAPID-ключ для підписки на клієнті.
app.get('/api/push/vapid', (req, res) => res.json({ publicKey: process.env.VAPID_PUBLIC || null }))

// Зберегти підписку на пуші для поточного користувача.
app.post('/api/push/subscribe', auth, async (req, res) => {
  const sub = req.body.subscription
  if (!sub) return res.status(400).json({ error: 'no subscription' })
  await pool.query(
    `INSERT INTO push_subs (user_id, subscription) VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET subscription=$2, updated_at=now()`,
    [req.user.id, sub]
  )
  res.json({ ok: true })
})

app.get('/api/health', (req, res) => res.json({ ok: true, push: PUSH_ON }))

// Статика фронту + SPA-fallback.
const dist = path.join(__dirname, 'dist')
app.use(express.static(dist))
app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')))

// ─────────────────────────── WebSocket: реальний звʼязок ───────────────────────────
// Звʼязує замовника й водія в одній поїздці. Модель: перший водій, що прийняв,
// отримує замовлення. Далі — стрім координат водія до замовника та синхронізація
// статусів (прибув → пасажир «почати» → у дорозі → завершено).
const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

const online = new Map() // ws(водій) -> { profile, coord }
const rides = new Map() // rideId -> { id, passenger, riderProfile, ...coords, fare, status, driver, driverProfile }
let rideSeq = 1

const send = (ws, event, payload) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ event, payload }))
}

wss.on('connection', (ws, req) => {
  try {
    const token = new URL(req.url, 'http://x').searchParams.get('token')
    const u = jwt.verify(token, JWT_SECRET)
    ws.userId = u.id
    ws.phone = u.phone
  } catch {
    ws.close(4001, 'auth')
    return
  }

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    handleWs(ws, msg.event, msg.payload || {})
  })

  ws.on('close', () => {
    online.delete(ws)
    // Розрив звʼязку може бути просто оновленням сторінки (refresh).
    // Не вбиваємо поїздку одразу — даємо 60 c на переподключення (ride:resume).
    for (const ride of rides.values()) {
      if (ride.driver === ws) ride.driver = null
      if (ride.passenger === ws) ride.passenger = null
      if ((ride.driver === null || ride.passenger === null) && !ride.graceTimer) {
        ride.graceTimer = setTimeout(() => {
          send(ride.passenger, 'ride:cancel', { rideId: ride.id })
          send(ride.driver, 'ride:cancel', { rideId: ride.id })
          rides.delete(ride.id)
        }, 60000)
      }
    }
  })
})

function handleWs(ws, event, p) {
  switch (event) {
    case 'driver:online':
      ws.role = 'driver'
      online.set(ws, { profile: p.profile, coord: p.coord })
      break

    case 'driver:offline':
      online.delete(ws)
      break

    case 'ride:resume': {
      // Клієнт повернувся після refresh — переприлінковуємо сокет до поїздки.
      const ride = rides.get(p.rideId)
      if (!ride) {
        send(ws, 'ride:gone', { rideId: p.rideId })
        return
      }
      if (p.role === 'driver') ride.driver = ws
      else {
        ride.passenger = ws
        ride.passengerUserId = ws.userId
      }
      ws.rideId = ride.id
      if (ride.graceTimer) {
        clearTimeout(ride.graceTimer)
        ride.graceTimer = null
      }
      send(ws, 'ride:resumed', { rideId: ride.id, status: ride.status })
      break
    }

    case 'ride:create': {
      const id = 'r' + rideSeq++
      const ride = {
        id,
        passenger: ws,
        passengerUserId: ws.userId,
        riderProfile: p.profile,
        from: p.from,
        to: p.to,
        pickupCoord: p.pickupCoord,
        destCoord: p.destCoord,
        driverStartCoord: p.driverStartCoord,
        fare: p.fare,
        status: 'searching',
        driver: null,
        driverProfile: null,
      }
      rides.set(id, ride)
      ws.rideId = id
      send(ws, 'ride:created', { rideId: id, driversOnline: online.size })
      // Розсилаємо запит усім онлайн-водіям.
      for (const dws of online.keys()) {
        send(dws, 'ride:request', {
          rideId: id,
          rider: p.profile || { name: 'Пасажир' },
          fare: p.fare,
          fromLabel: p.from,
          toLabel: p.to,
          pickup: p.pickupCoord,
          dest: p.destCoord,
          driverStart: p.driverStartCoord,
        })
      }
      break
    }

    case 'ride:accept': {
      // Перший водій, що прийняв, отримує поїздку.
      const ride = rides.get(p.rideId)
      if (!ride || ride.driver) {
        send(ws, 'ride:taken', { rideId: p.rideId })
        return
      }
      ride.driver = ws
      ride.driverProfile = p.profile || online.get(ws)?.profile || { name: 'Водій' }
      ride.status = 'assigned'
      ws.rideId = ride.id
      send(ride.passenger, 'ride:matched', { rideId: ride.id, driver: ride.driverProfile })
      send(ws, 'ride:assigned', {
        rideId: ride.id,
        rider: ride.riderProfile,
        fromLabel: ride.from,
        toLabel: ride.to,
        pickup: ride.pickupCoord,
        dest: ride.destCoord,
        driverStart: ride.driverStartCoord,
        fare: ride.fare,
      })
      for (const dws of online.keys()) if (dws !== ws) send(dws, 'ride:taken', { rideId: ride.id })
      break
    }

    case 'driver:location': {
      const ride = rides.get(p.rideId || ws.rideId)
      if (ride) send(ride.passenger, 'driver:location', { coord: p.coord, heading: p.heading })
      break
    }

    case 'ride:status': {
      const ride = rides.get(p.rideId || ws.rideId)
      if (ride) {
        ride.status = p.status
        send(ride.passenger, 'ride:status', { status: p.status })
        // Пуш замовнику — спрацює навіть якщо вкладку згорнуто.
        if (p.status === 'arrived') {
          const dn = ride.driverProfile?.name || 'Водій'
          const plate = ride.driverProfile?.plate ? ` · ${ride.driverProfile.plate}` : ''
          pushToUser(ride.passengerUserId, {
            title: 'Водій прибув 🚕',
            body: `${dn}${plate} чекає на вас за адресою: ${ride.from || 'точка подачі'}`,
            url: '/rider/enroute',
          })
        }
      }
      break
    }

    case 'ride:start': {
      // Пасажир вийшов і підтвердив → водій починає рух за маршрутом замовлення.
      const ride = rides.get(p.rideId || ws.rideId)
      if (ride && ride.driver) {
        ride.status = 'in_trip'
        send(ride.driver, 'ride:start', { rideId: ride.id })
      }
      break
    }

    case 'ride:complete': {
      const ride = rides.get(p.rideId || ws.rideId)
      if (ride) {
        send(ride.passenger, 'ride:complete', { rideId: ride.id })
        rides.delete(ride.id)
      }
      break
    }

    case 'ride:cancel': {
      const ride = rides.get(p.rideId || ws.rideId)
      if (ride) {
        const other = ws === ride.passenger ? ride.driver : ride.passenger
        send(other, 'ride:cancel', { rideId: ride.id })
        rides.delete(ride.id)
      }
      break
    }
  }
}

initDb()
  .then(() => server.listen(PORT, () => console.log('Svitlo on :' + PORT)))
  .catch((e) => {
    console.error('DB init failed:', e)
    server.listen(PORT, () => console.log('Svitlo on :' + PORT + ' (no DB)'))
  })
