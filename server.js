// Svitlo backend — роздає зібраний фронт (dist) і надає auth-API.
// БД: Postgres (DATABASE_URL). Логін: телефон + пароль (bcrypt), сесія — JWT.
import express from 'express'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
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

app.get('/api/health', (req, res) => res.json({ ok: true }))

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
    for (const ride of rides.values()) {
      if (ride.driver === ws) send(ride.passenger, 'ride:cancel', { rideId: ride.id, by: 'driver' })
      else if (ride.passenger === ws) {
        if (ride.driver) send(ride.driver, 'ride:cancel', { rideId: ride.id, by: 'rider' })
        rides.delete(ride.id)
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

    case 'ride:create': {
      const id = 'r' + rideSeq++
      const ride = {
        id,
        passenger: ws,
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
