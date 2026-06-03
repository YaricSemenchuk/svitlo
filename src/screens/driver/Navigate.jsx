import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrip } from '../../state/TripContext'
import { useDriverTracking } from '../../lib/useDriverTracking'
import LiveMap from '../../components/LiveMap'
import { PLACES } from '../../lib/maps'
import { TopBar, Sheet, BarHead, NavBanner, Avatar, Btn } from '../../components/ui'

function banner(p, km) {
  if (km < 0.05) return { arrow: '◉', title: 'Прибуття', sub: 'пункт подачі' }
  if (p < 0.34) return { arrow: '↑', title: 'Прямо по вул. Володимирській', sub: 'тримайтесь смуги' }
  if (p < 0.66) return { arrow: '↱', title: 'Поверніть праворуч на Хрещатик', sub: 'через 200 м' }
  return { arrow: '↰', title: 'Пункт подачі ліворуч', sub: 'вул. Хрещатик, 22' }
}

export default function Navigate() {
  const nav = useNavigate()
  const { state } = useTrip()
  const { permission, speed } = useDriverTracking({ enabled: true })
  const [info, setInfo] = useState({ p: 0, km: 1.2 })

  const onProgress = (p, i) => setInfo({ p, km: i.km })

  const km = info.km
  const mins = Math.max(1, Math.round(km * 3))
  const b = banner(info.p, km)

  return (
    <div className="screen">
      <LiveMap
        role="driver"
        start={state.driverStartCoord}
        pickup={state.pickupCoord}
        durationMs={16000}
        onProgress={onProgress}
      />

      <div className="float-top">
        <TopBar left="● ДО ПАСАЖИРА" right={`${mins} хв · ${km.toFixed(1)} km`} />
        <div style={{ marginTop: 10 }}>
          <NavBanner arrow={b.arrow} title={b.title} sub={b.sub} />
        </div>
        {permission === 'denied' && (
          <div className="permission-warn" style={{ marginTop: 10 }}>
            Дозвольте доступ до геолокації, щоб вести трекінг позиції.
          </div>
        )}
      </div>

      <div className="float-bottom">
        <Sheet>
          <BarHead left="NAVIGATE → PICKUP" right={`${speed || 38} km/h`} />
          <div className="driver-card">
            <Avatar label={state.rider?.initials || 'ЯС'} kind="rider" />
            <div className="dc-main">
              <div className="dc-name">{state.rider?.name || 'Яр. С.'}</div>
              <div className="dc-sub">★ {state.rider?.rating ?? 4.9} · вул. Хрещатик, 22</div>
            </div>
          </div>
          <Btn variant="primary" onClick={() => nav('/driver/trip')}>
            Я НА МІСЦІ
          </Btn>
        </Sheet>
      </div>
    </div>
  )
}
