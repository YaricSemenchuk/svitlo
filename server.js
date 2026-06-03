// Svitlo backend — роздає зібраний фронт (dist) і надає auth-API.
// БД: Postgres (DATABASE_URL). Логін: телефон + пароль (bcrypt), сесія — JWT.
import express from 'express'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import path from 'path'
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

initDb()
  .then(() => app.listen(PORT, () => console.log('Svitlo on :' + PORT)))
  .catch((e) => {
    console.error('DB init failed:', e)
    // Піднімаємо сервер усе одно — фронт працюватиме, API віддаватиме 500.
    app.listen(PORT, () => console.log('Svitlo on :' + PORT + ' (no DB)'))
  })
