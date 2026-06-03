import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone } from 'lucide-react'
import { useTrip } from '../../state/TripContext'
import LiveMap from '../../components/LiveMap'
import { haversine } from '../../lib/maps'
import { TopBar, Avatar, Row, Chip, Btn, TimerRing } from '../../components/ui'

export default function Request() {
  const nav = useNavigate()
  const { state, realtime, dispatch } = useTrip()
  const r = state.rider
  const [left, setLeft] = useState(12)
  const decided = useRef(false)

  // Реальні дистанції з координат маршруту.
  const pickupKm = (haversine(state.driverStartCoord, state.pickupCoord) / 1000).toFixed(1)
  const pickupMin = Math.max(1, Math.round(pickupKm / 0.45))
  const tripKm = (haversine(state.pickupCoord, state.destCoord) / 1000).toFixed(1)

  const decline = () => {
    if (decided.current) return
    decided.current = true
    realtime.emit('ride:cancel')
    dispatch({ type: 'RESET' })
    nav('/driver/online')
  }

  const accept = () => {
    if (decided.current) return
    decided.current = true
    dispatch({ type: 'ACCEPT_REQUEST' })
    realtime.emit('ride:accept')
    nav('/driver/navigate')
  }

  // Таймер прийняття.
  useEffect(() => {
    const id = setInterval(() => {
      setLeft((x) => {
        if (x <= 1) {
          clearInterval(id)
          decline()
          return 0
        }
        return x - 1
      })
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fare = state.fare || 210

  return (
    <div className="screen">
      {/* Статична карта: пунктир driverStart→pickup, «я» + ромб подачі. */}
      <LiveMap
        role="rider"
        start={state.driverStartCoord}
        pickup={state.pickupCoord}
        car={{ coord: state.driverStartCoord, heading: 0 }}
      />

      <div className="float-top">
        <TopBar variant="warn" left="⚠ НОВИЙ ЗАПИТ" right="×1.0" />
      </div>

      <div className="float-bottom">
        <div className="sheet" style={{ border: '1px solid var(--lime)' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: 12 }}>
              <TimerRing value={left} max={12} />
              <div className="tag">
                ПРИЙНЯТИ ЗА
                <br />
                <span className="lime mono" style={{ fontSize: 14 }}>
                  0:{String(left).padStart(2, '0')}
                </span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="tag">ОФЕР ПАСАЖИРА</div>
              <span className="big-num" style={{ fontSize: 26 }}>
                +{fare} ₴
              </span>
            </div>
          </div>

          <div className="divider" />

          <div className="driver-card">
            <Avatar label={r?.initials || 'ЯС'} kind="rider" />
            <div className="dc-main">
              <div className="dc-name">{r?.name || 'Яр. С.'}</div>
              <div className="dc-sub">
                ★ {r?.rating ?? 4.9} · {r?.trips ?? 134} поїздки · оплата {r?.pay || 'A·Pay'}
              </div>
            </div>
            {r?.phone && (
              <a className="icon-btn" style={{ flex: '0 0 auto', width: 48 }} href={`tel:${r.phone.replace(/\s/g, '')}`}>
                <Phone size={18} />
              </a>
            )}
          </div>
          {r?.phone && <div className="tag">☎ {r.phone}</div>}

          <Row tag="ПОДАЧА" v={`${state.from} · ${pickupKm} km · ${pickupMin} min`} />
          <Row tag="КУДИ" v={`${state.to} · ${tripKm} km`} />

          <div className="chips">
            <Chip on>[x] silent</Chip>
            <Chip on>[x] no-smoke</Chip>
            <Chip>Комфорт</Chip>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <Btn variant="ghost" onClick={decline}>
              Відхилити
            </Btn>
            <Btn variant="primary" onClick={accept}>
              ✓ Прийняти · {fare} ₴
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
