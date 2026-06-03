import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useTrip } from '../state/TripContext'
import { apiRegister, apiUpdateProfile, getToken, setToken } from '../lib/api'
import { Btn } from '../components/ui'

// Ініціали з імені (до 2 слів).
function initialsOf(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '••'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

const PAY_OPTIONS = ['Apple Pay', 'Google Pay', 'Картка (Mono)', 'Готівка']

export default function Register({ role }) {
  const nav = useNavigate()
  const { state, dispatch } = useTrip()
  const isDriver = role === 'driver'
  const loggedIn = state.auth.loggedIn
  const existing = state.profiles[role] || {}

  const [form, setForm] = useState({
    name: existing.name || '',
    phone: existing.phone || state.auth.phone || '',
    password: '',
    car: existing.car || '',
    color: existing.color || '',
    plate: existing.plate || '',
    pay: existing.pay || 'Apple Pay',
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const valid =
    form.name.trim() &&
    form.phone.trim() &&
    (loggedIn || form.password.length >= 4) &&
    (!isDriver || (form.car.trim() && form.plate.trim()))

  const submit = async () => {
    if (!valid || busy) return
    setErr('')
    setBusy(true)
    const initials = initialsOf(form.name)
    const profile = isDriver
      ? {
          name: form.name.trim(),
          phone: form.phone.trim(),
          car: form.car.trim(),
          color: form.color.trim(),
          plate: form.plate.trim().toUpperCase(),
          initials,
          rating: 5.0,
          trips: 0,
          etaMin: 3,
          km: 1.0,
        }
      : {
          name: form.name.trim(),
          phone: form.phone.trim(),
          pay: form.pay,
          initials,
          rating: 5.0,
          trips: 0,
        }
    try {
      if (loggedIn) {
        // Додаємо/оновлюємо профіль ролі до наявного акаунта.
        const { user } = await apiUpdateProfile(getToken(), role, profile)
        dispatch({ type: 'SET_SESSION', phone: user.phone, profiles: user.profiles })
      } else {
        const { token, user } = await apiRegister({
          phone: form.phone.trim(),
          password: form.password,
          role,
          profile,
        })
        setToken(token)
        dispatch({ type: 'SET_SESSION', phone: user.phone, profiles: user.profiles })
      }
      nav(isDriver ? '/driver/online' : '/rider/order')
    } catch (e) {
      setErr(e.message || 'Помилка реєстрації')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="home register">
      <div className="brand">
        <button className="back" onClick={() => nav('/')} aria-label="назад">
          <ChevronLeft size={22} />
        </button>
        <div>
          <h1>{isDriver ? 'Реєстрація водія' : 'Реєстрація замовника'}</h1>
          <div className="sub">{isDriver ? 'DRIVER · PROFILE' : 'RIDER · PROFILE'}</div>
        </div>
      </div>

      <div className="field-row">
        <span className="row-tag">ІМ’Я</span>
        <input
          className="field-input"
          value={form.name}
          placeholder="Ваше ім’я та прізвище"
          onChange={(e) => set('name', e.target.value)}
        />
      </div>

      <div className="field-row">
        <span className="row-tag">ТЕЛ</span>
        <input
          className="field-input"
          type="tel"
          inputMode="tel"
          value={form.phone}
          placeholder="+380 __ ___ __ __"
          disabled={loggedIn}
          onChange={(e) => set('phone', e.target.value)}
        />
      </div>

      {!loggedIn && (
        <div className="field-row">
          <span className="row-tag">ПАРОЛЬ</span>
          <input
            className="field-input"
            type="password"
            value={form.password}
            placeholder="мін. 4 символи"
            onChange={(e) => set('password', e.target.value)}
          />
        </div>
      )}

      {isDriver && (
        <>
          <div className="field-row">
            <span className="row-tag">АВТО</span>
            <input
              className="field-input"
              value={form.car}
              placeholder="Марка та модель (напр. Škoda Octavia)"
              onChange={(e) => set('car', e.target.value)}
            />
          </div>
          <div className="field-row">
            <span className="row-tag">КОЛІР</span>
            <input
              className="field-input"
              value={form.color}
              placeholder="Колір авто (напр. сірий)"
              onChange={(e) => set('color', e.target.value)}
            />
          </div>
          <div className="field-row">
            <span className="row-tag">НОМЕР</span>
            <input
              className="field-input plate-input"
              value={form.plate}
              placeholder="АА 0000 ВС"
              onChange={(e) => set('plate', e.target.value)}
            />
          </div>
        </>
      )}

      {!isDriver && (
        <div className="price-editor">
          <div className="tag">// ОПЛАТА</div>
          <div className="chips">
            {PAY_OPTIONS.map((p) => (
              <span key={p} className={`chip${form.pay === p ? ' on' : ''}`}>
                <button onClick={() => set('pay', p)} style={{ all: 'unset' }}>
                  {p}
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {err && <div className="permission-warn">{err}</div>}

      <div style={{ flex: 1 }} />

      {!loggedIn && (
        <button className="link-row" onClick={() => nav('/login')}>
          Вже маєте акаунт? <span className="lime">Увійти</span>
        </button>
      )}

      <Btn variant="primary" onClick={submit} disabled={!valid || busy}>
        {busy ? 'Збереження…' : valid ? 'Зберегти й продовжити' : 'Заповніть обов’язкові поля'}
      </Btn>
    </div>
  )
}
