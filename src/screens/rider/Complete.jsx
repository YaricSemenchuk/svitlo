import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrip } from '../../state/TripContext'
import LiveMap from '../../components/LiveMap'
import { PLACES } from '../../lib/maps'
import { TopBar, Sheet, BarHead, Btn } from '../../components/ui'

export default function Complete() {
  const nav = useNavigate()
  const { state, dispatch } = useTrip()
  const [rating, setRating] = useState(0)

  const done = () => {
    dispatch({ type: 'RESET' })
    nav('/rider/order')
  }

  return (
    <div className="screen">
      {/* Статична карта прибуття: маркер у точці призначення. */}
      <LiveMap
        role="rider"
        start={state.destCoord}
        pickup={state.destCoord}
        car={{ coord: state.destCoord, heading: 0 }}
      />

      <div className="float-top">
        <TopBar left="✓ ЗАВЕРШЕНО" right="22:14" />
      </div>

      <div className="float-bottom">
        <Sheet>
          <BarHead left="RECEIPT" right="#SV-48217" />

          <div className="receipt">
            <div className="r-line">
              <span className="rk">Тариф Комфорт</span>
              <span>198 ₴</span>
            </div>
            <div className="r-line">
              <span className="rk">Відстань · 34.2 km</span>
              <span>+38 ₴</span>
            </div>
            <div className="r-line">
              <span className="rk">Час · 42 min</span>
              <span>+12 ₴</span>
            </div>
            <div className="r-line">
              <span className="rk">Оплата</span>
              <span>Apple Pay · •4291</span>
            </div>
            <div className="divider" />
            <div className="r-total">
              <span>РАЗОМ</span>
              <span className="lime">{state.fare} ₴</span>
            </div>
          </div>

          <div className="tag" style={{ textAlign: 'center' }}>
            ОЦІНІТЬ ВОДІЯ
          </div>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={n <= rating ? 'on' : ''} onClick={() => setRating(n)}>
                ★
              </button>
            ))}
          </div>

          <Btn variant="primary" onClick={done}>
            Готово
          </Btn>
        </Sheet>
      </div>
    </div>
  )
}
