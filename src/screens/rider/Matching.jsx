import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrip } from '../../state/TripContext'
import LiveMap from '../../components/LiveMap'
import { TopBar, Sheet, BarHead, Progress, Btn } from '../../components/ui'

export default function Matching() {
  const nav = useNavigate()
  const { state, realtime, dispatch } = useTrip()
  const [t, setT] = useState(0)

  // Водія знайдено (ride:matched → status 'arriving') → у дорозі.
  useEffect(() => {
    if (state.status === 'arriving') nav('/rider/enroute')
  }, [state.status, nav])

  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const cancel = () => {
    realtime.emit('ride:cancel')
    dispatch({ type: 'RESET' })
    nav('/rider/order')
  }

  const noDrivers = state.driversOnline === 0
  const mm = String(Math.floor(t / 60))
  const ss = String(t % 60).padStart(2, '0')

  return (
    <div className="screen">
      <LiveMap role="rider" start={state.pickupCoord} pickup={state.driverStartCoord} />
      {!noDrivers && (
        <div className="radar">
          <span />
        </div>
      )}

      <div className="float-top">
        <TopBar left="● ПОШУК ВОДІЯ" right={`${mm}:${ss}`} />
      </div>

      <div className="float-bottom">
        <Sheet>
          <BarHead left="MATCHING" right={`ВАША ЦІНА ${state.fare} ₴`} />

          {noDrivers ? (
            <>
              <div className="tag">// поблизу немає вільних водіїв</div>
              <div className="log">
                <div>{'> водіїв онлайн: 0'}</div>
                <div className="hl">{'> очікуємо, поки хтось вийде в мережу…'}</div>
              </div>
              <Progress value={0.15} />
            </>
          ) : (
            <>
              <div className="tag">// надіслано {state.driversOnline} водіям поблизу</div>
              <div className="log">
                <div>{'> ваша ціна ' + state.fare + ' ₴ надіслана'}</div>
                <div>{'> водіїв онлайн: ' + state.driversOnline}</div>
                <div className="hl">{'> очікуємо підтвердження водія_'}</div>
              </div>
              <Progress value={Math.min(0.92, 0.2 + t / 20)} />
            </>
          )}

          <Btn variant="danger" onClick={cancel}>
            Скасувати пошук
          </Btn>
        </Sheet>
      </div>
    </div>
  )
}
