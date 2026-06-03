import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrip } from '../../state/TripContext'
import { useDriverTracking } from '../../lib/useDriverTracking'
import LiveMap from '../../components/LiveMap'
import { haversine } from '../../lib/maps'
import { TopBar, Sheet, BarHead, Metric, Metrics, Row, Btn } from '../../components/ui'

export default function DriverTrip() {
  const nav = useNavigate()
  const { state, dispatch, realtime } = useTrip()
  const { coord, heading } = useDriverTracking({ enabled: true })
  const [info, setInfo] = useState({ p: 0, km: 22.4 })

  const onProgress = (p, i) => setInfo({ p, km: i.km })

  const finish = () => {
    // Повідомляємо замовника про завершення → у нього зʼявиться чек.
    realtime.emit('ride:complete')
    dispatch({ type: 'RESET' })
    nav('/driver/online')
  }

  // Поїздку втрачено/скасовано → назад онлайн.
  useEffect(() => {
    if (state.status === 'idle') nav('/driver/online')
  }, [state.status, nav])

  // Реальний GPS → карта показує мою позицію; інакше демо.
  const hasGps = !!coord
  const total = Math.max(1, haversine(state.pickupCoord, state.destCoord))
  const remaining = hasGps ? haversine(coord, state.destCoord) : null
  const p = hasGps ? 1 - Math.min(1, remaining / total) : info.p
  const minsLeft = Math.max(1, Math.round((1 - p) * 26))
  const dist = hasGps ? (remaining / 1000).toFixed(1) : (info.km || 0).toFixed(1)
  const yours = state.fare || 210

  return (
    <div className="screen">
      <LiveMap
        role="driver"
        start={state.pickupCoord}
        pickup={state.destCoord}
        durationMs={26000}
        onProgress={hasGps ? undefined : onProgress}
        car={hasGps ? { coord, heading } : null}
      />

      <div className="float-top">
        <TopBar left={`● ПОЇЗДКА → ${state.to}`} right={`ETA ~${minsLeft} min`} />
      </div>

      <div className="float-bottom">
        <Sheet>
          <BarHead left="TRIP · ACTIVE" right={`METER ${state.fare} ₴`} />
          <Row
            tag="PAX"
            v={state.rider?.name || 'Яр. С.'}
            x="[x] silent · [x] no-smoke"
          />
          <Metrics>
            <Metric k="LEFT" v={`${minsLeft} min`} />
            <Metric k="DIST" v={`${dist} km`} />
            <Metric k="YOURS" v={`+${yours} ₴`} />
          </Metrics>
          <Btn variant="primary" onClick={finish}>
            Завершити поїздку
          </Btn>
        </Sheet>
      </div>
    </div>
  )
}
