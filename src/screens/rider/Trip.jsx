import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, OctagonAlert } from 'lucide-react'
import { useTrip } from '../../state/TripContext'
import LiveMap from '../../components/LiveMap'
import { PLACES } from '../../lib/maps'
import { TopBar, Sheet, BarHead, Metric, Metrics, Row, Btn } from '../../components/ui'

export default function RiderTrip() {
  const nav = useNavigate()
  const { state, dispatch } = useTrip()
  const doneRef = useRef(false)
  const [info, setInfo] = useState({ p: 0, km: 22.4 })

  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    dispatch({ type: 'COMPLETE' })
    nav('/rider/complete')
  }

  const onProgress = (p, i) => {
    setInfo({ p, km: i.km })
    if (p > 0.985) finish()
  }

  const minsLeft = Math.max(1, Math.round((1 - info.p) * 26))
  const dist = (info.km || 0).toFixed(1)

  return (
    <div className="screen">
      <LiveMap
        role="rider"
        start={PLACES.pickup}
        dest={PLACES.dest}
        durationMs={26000}
        onProgress={onProgress}
      />

      <div className="float-top">
        <TopBar left="● У ДОРОЗІ → BORYSPIL" right={`ETA ${minsLeft} min`} />
      </div>

      <div className="float-bottom">
        <Sheet>
          <BarHead left="TRIP · ACTIVE" right={`METER ${state.fare} ₴`} />
          <Metrics>
            <Metric k="LEFT" v={`${minsLeft} min`} />
            <Metric k="DIST" v={`${dist} km`} />
            <Metric k="FARE" v={`${state.fare} ₴`} />
          </Metrics>
          <Row tag="DRV" v={state.driver?.name || 'Олександр К.'} x={state.driver?.plate || 'АА 7421 ВС'} />
          <div className="row" style={{ gap: 8 }}>
            <Btn variant="primary" onClick={() => {}}>
              <MapPin size={16} /> Share trip
            </Btn>
            <Btn variant="danger" onClick={() => {}}>
              <OctagonAlert size={16} /> SOS
            </Btn>
          </div>
          <Btn variant="ghost" onClick={finish}>
            Завершити поїздку
          </Btn>
        </Sheet>
      </div>
    </div>
  )
}
