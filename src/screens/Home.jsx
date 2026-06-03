import { useNavigate } from 'react-router-dom'
import { User, Car, Pencil } from 'lucide-react'
import { useTrip } from '../state/TripContext'
import InstallQR from '../components/InstallQR'

export default function Home() {
  const nav = useNavigate()
  const { state, dispatch } = useTrip()
  const { profiles } = state

  // Вибір ролі: якщо немає профілю — спершу реєстрація.
  const go = (role) => {
    dispatch({ type: 'SET_ROLE', role })
    const flow = role === 'rider' ? '/rider/order' : '/driver/online'
    nav(profiles[role] ? flow : `/register/${role}`)
  }

  const edit = (e, role) => {
    e.stopPropagation()
    dispatch({ type: 'SET_ROLE', role })
    nav(`/register/${role}`)
  }

  return (
    <div className="home">
      <div className="brand">
        <div className="logo">S</div>
        <div>
          <h1>Svitlo</h1>
          <div className="sub">таксі · київ · ₴</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button className="role-btn rider" onClick={() => go('rider')}>
          <div className="rb-top">
            <span className="rb-tag">PAX</span>
            <User className="rb-ic" size={22} />
          </div>
          <span className="rb-title">Я замовник</span>
          {profiles.rider ? (
            <span className="rb-profile">
              {profiles.rider.name}
              <span className="ed" onClick={(e) => edit(e, 'rider')}>
                <Pencil size={12} /> змінити
              </span>
            </span>
          ) : (
            <span className="rb-profile muted">реєстрація →</span>
          )}
        </button>

        <button className="role-btn driver" onClick={() => go('driver')}>
          <div className="rb-top">
            <span className="rb-tag">DRV</span>
            <Car className="rb-ic" size={22} />
          </div>
          <span className="rb-title">Я водій</span>
          {profiles.driver ? (
            <span className="rb-profile">
              {profiles.driver.plate}
              <span className="ed" onClick={(e) => edit(e, 'driver')}>
                <Pencil size={12} /> змінити
              </span>
            </span>
          ) : (
            <span className="rb-profile muted">реєстрація →</span>
          )}
        </button>
      </div>

      {state.ref && (
        <div className="tag" style={{ textAlign: 'center' }}>
          реферал: {state.ref}
        </div>
      )}

      <InstallQR />
    </div>
  )
}
