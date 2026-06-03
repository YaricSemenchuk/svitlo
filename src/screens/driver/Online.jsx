import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrip } from '../../state/TripContext'
import LiveMap from '../../components/LiveMap'
import { PLACES } from '../../lib/maps'
import { TopBar, Sheet, BarHead, Metric, Metrics, Btn } from '../../components/ui'

export default function Online() {
  const nav = useNavigate()
  const { state, realtime, dispatch } = useTrip()
  const [accepting, setAccepting] = useState(false)

  // На вхідний запит (RECEIVE_REQUEST → status 'requesting') → екран запиту.
  useEffect(() => {
    if (state.status === 'requesting') nav('/driver/request')
  }, [state.status, nav])

  // Після (пере)підключення WebSocket сервер «забуває» нас зі списку онлайн.
  // Якщо тумблер увімкнено — заявляємо себе онлайн знову, інакше заявки не йдуть.
  useEffect(() => {
    const off = realtime.on('rt:open', () => {
      if (accepting) realtime.emit('driver:online', { profile: state.profiles.driver })
    })
    return off
  }, [realtime, accepting, state.profiles.driver])

  const toggle = () => {
    const next = !accepting
    setAccepting(next)
    // Виходимо в мережу як реальний водій — сервер слатиме нам запити.
    if (next) realtime.emit('driver:online', { profile: state.profiles.driver })
    else realtime.emit('driver:offline')
  }

  const endShift = () => {
    dispatch({ type: 'RESET' })
    nav('/')
  }

  return (
    <div className="screen">
      <LiveMap
        role="driver"
        start={PLACES.driverStart}
        car={{ coord: PLACES.driverStart, heading: 0 }}
      />

      {/* Зони попиту (напівпрозорі лаймові кола) + виноска. */}
      <div
        className="zone"
        style={{ position: 'absolute', top: '26%', left: '18%', width: 120, height: 120, zIndex: 5 }}
      />
      <div
        className="zone"
        style={{ position: 'absolute', top: '40%', right: '12%', width: 90, height: 90, zIndex: 5 }}
      />
      <div
        className="tag lime"
        style={{ position: 'absolute', top: '24%', left: '20%', zIndex: 6 }}
      >
        ПОПИТ ВИСОКИЙ ×1.3
      </div>

      <div className="float-top">
        <TopBar left="● ONLINE" right="сьогодні 1 240 ₴" />
      </div>

      <div className="float-bottom">
        <Sheet>
          <BarHead left="STATUS · IDLE" right="ZONE ПЕЧЕРСЬК" />

          <div>
            <span className="big-num" style={{ fontSize: 40 }}>
              1 240 ₴
            </span>
            <div className="tag" style={{ marginTop: 4 }}>
              ЗАРОБЛЕНО СЬОГОДНІ
            </div>
          </div>

          <Metrics>
            <Metric k="RIDES" v="8" />
            <Metric k="ONLINE" v="6.2 год" />
            <Metric k="RATING" v="★4.92" />
          </Metrics>

          <div className="toggle-row">
            <span className="tr-label">ПРИЙМАЮ ЗАМОВЛЕННЯ</span>
            <button className={`switch${accepting ? ' on' : ''}`} onClick={toggle}>
              <i />
            </button>
          </div>

          <Btn variant="ghost" onClick={endShift}>
            Завершити зміну
          </Btn>
        </Sheet>
      </div>
    </div>
  )
}
