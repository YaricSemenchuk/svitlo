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
import { randomUUID } from 'crypto'
import Redis from 'ioredis'

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
//
// Горизонтальне масштабування: стан поїздок і реєстр онлайн-водіїв живуть у Redis
// (спільне джерело правди між інстансами), а доставку події конкретному клієнту
// робимо через pub/sub-шину — будь-який інстанс публікує подію, а той інстанс, де
// висить потрібний сокет, віддає її. Без REDIS_URL працюємо в памʼяті (1 процес).
const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL || ''
const redisOn = !!REDIS_URL
const pub = redisOn ? new Redis(REDIS_URL, { maxRetriesPerRequest: null }) : null
const sub = redisOn ? new Redis(REDIS_URL, { maxRetriesPerRequest: null }) : null
if (redisOn) {
  pub.on('error', (e) => console.error('redis pub', e.message))
  sub.on('error', (e) => console.error('redis sub', e.message))
}

const send = (ws, event, payload) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ event, payload }))
}

// ── Локальний реєстр сокетів цього інстансу ──
const localCids = new Map() // cid -> ws (усі підключення цього процесу)
const localDrivers = new Set() // ws — водії, що приймають замовлення (online)

const deliverClient = (cid, event, payload) => send(localCids.get(cid), event, payload)
const deliverDrivers = (event, payload, exclude) => {
  for (const ws of localDrivers) if (ws.cid !== exclude) send(ws, event, payload)
}

// ── Шина доставки (pub/sub або прямий виклик у памʼяті) ──
const BUS = 'svitlo:bus'
if (redisOn) {
  sub.subscribe(BUS)
  sub.on('message', (_ch, raw) => {
    let m
    try {
      m = JSON.parse(raw)
    } catch {
      return
    }
    if (m.kind === 'client') deliverClient(m.cid, m.event, m.payload)
    else if (m.kind === 'drivers') deliverDrivers(m.event, m.payload, m.exclude)
  })
}
// Доставити події конкретному клієнту (за cid) — на будь-якому інстансі.
const toClient = (cid, event, payload) => {
  if (!cid) return
  if (redisOn) pub.publish(BUS, JSON.stringify({ kind: 'client', cid, event, payload }))
  else deliverClient(cid, event, payload)
}
// Розіслати подію всім онлайн-водіям (крім exclude) на всіх інстансах.
const toDrivers = (event, payload, exclude) => {
  if (redisOn) pub.publish(BUS, JSON.stringify({ kind: 'drivers', event, payload, exclude }))
  else deliverDrivers(event, payload, exclude)
}

// ── Спільний стан: поїздки + presence водіїв ──
// Поїздка зберігається як JSON; замість сокет-рефів — cid сторін (passengerCid/driverCid).
const DRIVER_TTL = 90000 // presence водія протухає, якщо інстанс впав без SREM
const memRides = new Map()
const memDrivers = new Set()
let memSeq = 0

const store = redisOn
  ? {
      async nextRideId() {
        return 'r' + (await pub.incr('svitlo:seq'))
      },
      async saveRide(r) {
        await pub.set('svitlo:ride:' + r.id, JSON.stringify(r), 'EX', 3600)
        if (r.status === 'searching' && !r.driverCid) await pub.sadd('svitlo:searching', r.id)
        else await pub.srem('svitlo:searching', r.id)
      },
      async getRide(id) {
        const s = await pub.get('svitlo:ride:' + id)
        return s ? JSON.parse(s) : null
      },
      async delRide(id) {
        await pub.del('svitlo:ride:' + id)
        await pub.srem('svitlo:searching', id)
      },
      async searchingRides() {
        const ids = await pub.smembers('svitlo:searching')
        const out = []
        for (const id of ids) {
          const r = await this.getRide(id)
          if (r && r.status === 'searching' && !r.driverCid) out.push(r)
          else await pub.srem('svitlo:searching', id) // підчищаємо протухлі id
        }
        return out
      },
      // presence — ZSET cid→expiresAt; крах інстансу самоочищається за TTL.
      async addDriver(cid, now) {
        await pub.zadd('svitlo:drivers', now + DRIVER_TTL, cid)
      },
      async removeDriver(cid) {
        await pub.zrem('svitlo:drivers', cid)
      },
      async driverCount(now) {
        await pub.zremrangebyscore('svitlo:drivers', 0, now)
        return pub.zcard('svitlo:drivers')
      },
    }
  : {
      async nextRideId() {
        return 'r' + ++memSeq
      },
      async saveRide(r) {
        memRides.set(r.id, r)
      },
      async getRide(id) {
        return memRides.get(id) || null
      },
      async delRide(id) {
        memRides.delete(id)
      },
      async searchingRides() {
        return [...memRides.values()].filter((r) => r.status === 'searching' && !r.driverCid)
      },
      async addDriver(cid) {
        memDrivers.add(cid)
      },
      async removeDriver(cid) {
        memDrivers.delete(cid)
      },
      async driverCount() {
        return memDrivers.size
      },
    }

const rideRequestPayload = (ride) => ({
  rideId: ride.id,
  rider: ride.riderProfile || { name: 'Пасажир' },
  fare: ride.fare,
  fromLabel: ride.from,
  toLabel: ride.to,
  pickup: ride.pickupCoord,
  dest: ride.destCoord,
  driverStart: ride.driverStartCoord,
})

// Кількість онлайн-водіїв змінилась → оновлюємо лічильник у замовників у пошуку
// (інакше «0 водіїв» залипає, якщо водій вийшов онлайн пізніше).
async function broadcastDriverCount() {
  const count = await store.driverCount(Date.now())
  const rides = await store.searchingRides()
  for (const ride of rides) toClient(ride.passengerCid, 'drivers:count', { driversOnline: count })
}

// Heartbeat: продовжуємо TTL presence локальних водіїв, щоб живі не протухали.
if (redisOn) {
  setInterval(() => {
    const now = Date.now()
    for (const ws of localDrivers) store.addDriver(ws.cid, now).catch(() => {})
  }, 30000).unref()
}

// Грейс на переподключення (refresh ~60 c): якщо сторона не повернулась тим самим
// cid — скасовуємо поїздку. Таймер живе на інстансі, що бачив розрив; на момент
// спрацювання перечитує стан із Redis, тож resume на будь-якому інстансі його гасить.
function scheduleGrace(rideId, role, cid) {
  setTimeout(async () => {
    const ride = await store.getRide(rideId)
    if (!ride || ride.status === 'completed') return
    const field = role === 'driver' ? 'driverCid' : 'passengerCid'
    if (ride[field] !== cid) return // переподключився (новий cid) — нічого не робимо
    const other = role === 'driver' ? ride.passengerCid : ride.driverCid
    toClient(other, 'ride:cancel', { rideId })
    await store.delRide(rideId)
  }, 60000)
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

  ws.cid = randomUUID()
  localCids.set(ws.cid, ws)

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    handleWs(ws, msg.event, msg.payload || {}).catch((e) => console.error('ws', e))
  })

  ws.on('close', async () => {
    localCids.delete(ws.cid)
    if (localDrivers.delete(ws)) {
      await store.removeDriver(ws.cid)
      await broadcastDriverCount()
    }
    // Розрив може бути просто refresh — даємо 60 c на переподключення (ride:resume).
    if (ws.rideId && ws.rideRole) scheduleGrace(ws.rideId, ws.rideRole, ws.cid)
  })
})

async function handleWs(ws, event, p) {
  switch (event) {
    case 'driver:online': {
      ws.role = 'driver'
      ws.driverProfile = p.profile
      localDrivers.add(ws)
      await store.addDriver(ws.cid, Date.now())
      // Віддаємо водію всі поїздки, що зараз у пошуку (створені до його виходу
      // онлайн або до переподключення сокета) — інакше заявка «губиться».
      const rides = await store.searchingRides()
      for (const ride of rides) send(ws, 'ride:request', rideRequestPayload(ride))
      await broadcastDriverCount()
      break
    }

    case 'driver:offline': {
      localDrivers.delete(ws)
      await store.removeDriver(ws.cid)
      await broadcastDriverCount()
      break
    }

    case 'ride:resume': {
      // Клієнт повернувся після refresh — переприлінковуємо сокет (новий cid) до поїздки.
      const ride = await store.getRide(p.rideId)
      if (!ride) {
        send(ws, 'ride:gone', { rideId: p.rideId })
        return
      }
      if (p.role === 'driver') {
        ride.driverCid = ws.cid
        ride.driverUserId = ws.userId
        ws.rideRole = 'driver'
      } else {
        ride.passengerCid = ws.cid
        ride.passengerUserId = ws.userId
        ws.rideRole = 'passenger'
      }
      ws.rideId = ride.id
      await store.saveRide(ride)
      send(ws, 'ride:resumed', { rideId: ride.id, status: ride.status })
      break
    }

    case 'ride:create': {
      const id = await store.nextRideId()
      const ride = {
        id,
        passengerCid: ws.cid,
        passengerUserId: ws.userId,
        riderProfile: p.profile,
        from: p.from,
        to: p.to,
        pickupCoord: p.pickupCoord,
        destCoord: p.destCoord,
        driverStartCoord: p.driverStartCoord,
        fare: p.fare,
        status: 'searching',
        driverCid: null,
        driverUserId: null,
        driverProfile: null,
      }
      await store.saveRide(ride)
      ws.rideId = id
      ws.rideRole = 'passenger'
      const driversOnline = await store.driverCount(Date.now())
      send(ws, 'ride:created', { rideId: id, driversOnline })
      // Розсилаємо запит усім онлайн-водіям (на всіх інстансах).
      toDrivers('ride:request', rideRequestPayload(ride))
      break
    }

    case 'ride:accept': {
      // Перший водій, що прийняв, отримує поїздку (атомарність — через перевірку driverCid).
      const ride = await store.getRide(p.rideId)
      if (!ride || ride.driverCid) {
        send(ws, 'ride:taken', { rideId: p.rideId })
        return
      }
      ride.driverCid = ws.cid
      ride.driverUserId = ws.userId
      ride.driverProfile = p.profile || ws.driverProfile || { name: 'Водій' }
      ride.status = 'assigned'
      ws.rideId = ride.id
      ws.rideRole = 'driver'
      await store.saveRide(ride)
      toClient(ride.passengerCid, 'ride:matched', { rideId: ride.id, driver: ride.driverProfile })
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
      toDrivers('ride:taken', { rideId: ride.id }, ws.cid)
      break
    }

    case 'driver:location': {
      const ride = await store.getRide(p.rideId || ws.rideId)
      if (ride) toClient(ride.passengerCid, 'driver:location', { coord: p.coord, heading: p.heading })
      break
    }

    case 'ride:status': {
      const ride = await store.getRide(p.rideId || ws.rideId)
      if (ride) {
        ride.status = p.status
        await store.saveRide(ride)
        toClient(ride.passengerCid, 'ride:status', { status: p.status })
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
      const ride = await store.getRide(p.rideId || ws.rideId)
      if (ride && ride.driverCid) {
        ride.status = 'in_trip'
        await store.saveRide(ride)
        toClient(ride.driverCid, 'ride:start', { rideId: ride.id })
      }
      break
    }

    case 'ride:complete': {
      const ride = await store.getRide(p.rideId || ws.rideId)
      if (ride) {
        toClient(ride.passengerCid, 'ride:complete', { rideId: ride.id })
        await store.delRide(ride.id)
      }
      break
    }

    case 'ride:cancel': {
      const ride = await store.getRide(p.rideId || ws.rideId)
      if (ride) {
        const otherCid = ws.cid === ride.passengerCid ? ride.driverCid : ride.passengerCid
        toClient(otherCid, 'ride:cancel', { rideId: ride.id })
        await store.delRide(ride.id)
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
