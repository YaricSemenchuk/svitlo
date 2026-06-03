import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrip } from '../../state/TripContext'
import { useDriverTracking } from '../../lib/useDriverTracking'
import LiveMap from '../../components/LiveMap'
import { PLACES } from '../../lib/maps'
import { TopBar, Sheet, BarHead, Metric, Metrics, Row, Btn } from '../../components/ui'

export default function DriverTrip() {
  const nav = useNavigate()
  const { state, dispatch, realtime } = useTrip()
  useDriverTracking({ enabled: true })
  const [info, setInfo] = useState({ p: 0, km: 22.4 })

  const onProgress = (p, i) => setInfo({ p, km: i.km })

  const finish = () => {
    // Повідомляємо замовника про завершення → у нього зʼявиться чек.
    realtime.emit('ride:complete')
    dispatch({ type: 'RESET' })
    nav('/driver/online')
  }

  const minsLeft = Math.max(1, Math.round((1 - info.p) * 26))
  const dist = (info.km || 0).toFixed(1)
  const yours = state.fare || 210

  return (
    <div className="screen">
      <LiveMap
        role="driver"
        start={state.pickupCoord}
        pickup={state.destCoord}
        durationMs={26000}
        onProgress={onProgress}
      />

      <div className="float-top">
        <TopBar left="● ПОЇЗДКА → BORYSPIL" right={`ETA ${minsLeft} min`} />
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
