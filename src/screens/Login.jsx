import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useTrip } from '../state/TripContext'
import { apiLogin, setToken } from '../lib/api'
import { Btn } from '../components/ui'

export default function Login() {
  const nav = useNavigate()
  const { dispatch } = useTrip()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const valid = phone.trim() && password

  const submit = async () => {
    if (!valid || busy) return
    setErr('')
    setBusy(true)
    try {
      const { token, user } = await apiLogin({ phone: phone.trim(), password })
      setToken(token)
      dispatch({ type: 'SET_SESSION', phone: user.phone, profiles: user.profiles })
      nav('/')
    } catch (e) {
      setErr(e.message || 'Помилка входу')
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
          <h1>Вхід</h1>
          <div className="sub">LOGIN · PHONE</div>
        </div>
      </div>

      <div className="field-row">
        <span className="row-tag">ТЕЛ</span>
        <input
          className="field-input"
          type="tel"
          inputMode="tel"
          value={phone}
          placeholder="+380 __ ___ __ __"
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      <div className="field-row">
        <span className="row-tag">ПАРОЛЬ</span>
        <input
          className="field-input"
          type="password"
          value={password}
          placeholder="ваш пароль"
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {err && <div className="permission-warn">{err}</div>}

      <div style={{ flex: 1 }} />

      <button className="link-row" onClick={() => nav('/')}>
        Немає акаунта? <span className="lime">Зареєструватися</span>
      </button>

      <Btn variant="primary" onClick={submit} disabled={!valid || busy}>
        {busy ? 'Вхід…' : 'Увійти'}
      </Btn>
    </div>
  )
}
