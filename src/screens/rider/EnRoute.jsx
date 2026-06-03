import { useNavigate } from 'react-router-dom'
import { Phone, MessageSquare, Share2 } from 'lucide-react'
import { useTrip } from '../../state/TripContext'
import LiveMap from '../../components/LiveMap'
import { haversine } from '../../lib/maps'
import { TopBar, Sheet, BarHead, Avatar, Btn, Progress, Plate } from '../../components/ui'

export default function EnRoute() {
  const nav = useNavigate()
  const { state, realtime, dispatch } = useTrip()
  const d = state.driver

  // Дистанція подачі на основі реальних координат маршруту.
  const TOTAL = Math.max(1, haversine(state.driverStartCoord, state.pickupCoord)) // м
  const remaining = haversine(state.carCoord, state.pickupCoord) // м
  const km = remaining / 1000
  const mins = Math.max(1, Math.round((remaining / TOTAL) * (d?.etaMin || 4)))
  const etaSec = Math.max(0, Math.round((remaining / TOTAL) * (d?.etaMin || 4) * 60))
  const etaMM = String(Math.floor(etaSec / 60)).padStart(2, '0')
  const etaSS = String(etaSec % 60).padStart(2, '0')
  const progress = 1 - Math.min(1, remaining / TOTAL)
  const arrived = state.status === 'arrived'

  const cancel = () => {
    realtime.emit('ride:cancel')
    dispatch({ type: 'RESET' })
    nav('/rider/order')
  }

  const startTrip = () => {
    dispatch({ type: 'START_TRIP' })
    nav('/rider/trip')
  }

  return (
    <div className="screen">
      <LiveMap
        role="rider"
        start={state.driverStartCoord}
        pickup={state.pickupCoord}
        car={{ coord: state.carCoord, heading: state.carHeading }}
      />

      <div className="float-top">
        <TopBar left="● ВОДІЙ ПРЯМУЄ" right={arrived ? 'ПРИБУВ' : `ETA ${etaMM}:${etaSS}`} />
      </div>

      <div className="float-bottom">
        <Sheet>
          <BarHead left={`PICKUP · ${state.from}`} right="SURGE ×1.0" />

          {!arrived ? (
            <div>
              <span className="big-num" style={{ fontSize: 40 }}>
                {mins} хв
              </span>
              <div className="tag" style={{ marginTop: 4 }}>
                ДО ПОДАЧІ · {km.toFixed(1)} KM
              </div>
            </div>
          ) : (
            <div>
              <span className="big-num" style={{ fontSize: 32 }}>
                Водій на місці
              </span>
            </div>
          )}

          <Progress value={progress} />

          <div className="driver-card">
            <Avatar label={d?.initials || 'ОК'} kind="driver" />
            <div className="dc-main">
              <div className="dc-name">{d?.name || 'Олександр К.'}</div>
              <div className="dc-sub">
                ★ {d?.rating ?? 4.9} · {d?.car || 'Škoda Octavia'} · {d?.color || 'сірий'}
              </div>
            </div>
            <Plate>{d?.plate || 'АА 7421 ВС'}</Plate>
          </div>

          {d?.phone && (
            <div className="tag" style={{ letterSpacing: '0.04em' }}>
              ☎ {d.phone}
            </div>
          )}

          <div className="row" style={{ gap: 8 }}>
            <a className="icon-btn" href={d?.phone ? `tel:${d.phone.replace(/\s/g, '')}` : undefined}>
              <Phone size={18} />
            </a>
            <button className="icon-btn">
              <MessageSquare size={18} />
            </button>
            <button className="icon-btn">
              <Share2 size={18} />
            </button>
          </div>

          {arrived ? (
            <Btn variant="primary" onClick={startTrip}>
              Почати поїздку
            </Btn>
          ) : (
            <Btn variant="danger" onClick={cancel}>
              Скасувати
            </Btn>
          )}
        </Sheet>
      </div>
    </div>
  )
}
