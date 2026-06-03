import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, OctagonAlert } from 'lucide-react'
import { useTrip } from '../../state/TripContext'
import LiveMap from '../../components/LiveMap'
import { haversine } from '../../lib/maps'
import { TopBar, Sheet, BarHead, Metric, Metrics, Row, Btn } from '../../components/ui'

export default function RiderTrip() {
  const nav = useNavigate()
  const { state } = useTrip()

  // Поїздку завершує водій → status 'completed' → чек.
  useEffect(() => {
    if (state.status === 'completed') nav('/rider/complete')
    else if (state.status === 'idle') nav('/rider/order')
  }, [state.status, nav])

  // Прогрес/відстань — за реальною позицією авто (driver:location).
  const total = Math.max(1, haversine(state.pickupCoord, state.destCoord))
  const remaining = haversine(state.carCoord, state.destCoord)
  const km = (remaining / 1000).toFixed(1)
  const minsLeft = Math.max(1, Math.round((remaining / total) * 26))

  return (
    <div className="screen">
      <LiveMap
        role="rider"
        start={state.pickupCoord}
        pickup={state.destCoord}
        car={{ coord: state.carCoord, heading: state.carHeading }}
      />

      <div className="float-top">
        <TopBar left={`● У ДОРОЗІ → ${state.to}`} right={`ETA ~${minsLeft} min`} />
      </div>

      <div className="float-bottom">
        <Sheet>
          <BarHead left="TRIP · ACTIVE" right={`METER ${state.fare} ₴`} />
          <Metrics>
            <Metric k="LEFT" v={`~${minsLeft} min`} />
            <Metric k="DIST" v={`${km} km`} />
            <Metric k="FARE" v={`${state.fare} ₴`} />
          </Metrics>
          <Row
            tag="DRV"
            v={state.driver?.name || 'Водій'}
            x={state.driver?.plate || ''}
          />
          <div className="row" style={{ gap: 8 }}>
            <Btn variant="primary" onClick={() => {}}>
              <MapPin size={16} /> Share trip
            </Btn>
            <Btn variant="danger" onClick={() => {}}>
              <OctagonAlert size={16} /> SOS
            </Btn>
          </div>
        </Sheet>
      </div>
    </div>
  )
}
