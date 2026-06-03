import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrip } from '../../state/TripContext'
import LiveMap from '../../components/LiveMap'
import { PLACES } from '../../lib/maps'
import { TopBar, Sheet, BarHead, Avatar, Progress, Btn } from '../../components/ui'

export default function Matching() {
  const nav = useNavigate()
  const { state, realtime, dispatch } = useTrip()
  const [t, setT] = useState(0)

  // Після вибору оффера status стає 'arriving' → enroute.
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

  const select = (offer) => {
    dispatch({ type: 'SELECT_OFFER', driver: offer })
    realtime.emit('ride:select', { driver: offer })
    nav('/rider/enroute')
  }

  const offers = state.offers
  const mm = String(Math.floor(t / 60))
  const ss = String(t % 60).padStart(2, '0')

  // Жодних офферів за розумний час → поблизу немає вільних водіїв.
  const noDrivers = offers.length === 0 && t >= 6

  return (
    <div className="screen">
      <LiveMap role="rider" start={state.pickupCoord} pickup={state.driverStartCoord} />
      {offers.length === 0 && !noDrivers && (
        <div className="radar">
          <span />
        </div>
      )}

      <div className="float-top">
        <TopBar
          left={offers.length ? '● ОБЕРІТЬ ВОДІЯ' : '● ПОШУК ВОДІЯ'}
          right={`${mm}:${ss}`}
        />
      </div>

      <div className="float-bottom">
        <Sheet>
          <BarHead
            left={offers.length ? `ОФФЕРИ · ${offers.length}` : 'MATCHING'}
            right={`ВАША ЦІНА ${state.fare} ₴`}
          />

          {offers.length === 0 ? (
            noDrivers ? (
              <>
                <div className="tag">// поблизу немає вільних водіїв</div>
                <div className="log">
                  <div>{'> онлайн-водіїв за вашою ціною: 0'}</div>
                  <div className="hl">{'> підвищіть ціну або спробуйте пізніше'}</div>
                </div>
              </>
            ) : (
              <>
                <div className="tag">// очікуємо пропозиції водіїв…</div>
                <div className="log">
                  <div>{'> пошук онлайн-водіїв поблизу'}</div>
                  <div>{'> надіслано вашу ціну ' + state.fare + ' ₴'}</div>
                  <div className="hl">{'> awaiting offers_'}</div>
                </div>
                <Progress value={Math.min(0.9, t / 5)} />
              </>
            )
          ) : (
            <div className="offers">
              {offers.map((o, i) => {
                const isCounter = (o.delta ?? 0) > 0
                return (
                  <button key={i} className="offer" onClick={() => select(o)}>
                    <Avatar label={o.initials} kind="driver" />
                    <div className="of-main">
                      <div className="of-name">
                        {o.name} <span className="of-rate">★ {o.rating}</span>
                      </div>
                      <div className="of-sub">
                        {o.car} · {o.etaMin} хв · {o.km} km
                      </div>
                    </div>
                    <div className="of-price">
                      <span className="of-amount">{o.price} ₴</span>
                      <span className={`of-tag ${isCounter ? 'counter' : 'match'}`}>
                        {isCounter ? `+${o.delta} ₴` : 'за вашою ціною'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          <Btn variant="danger" onClick={cancel}>
            Скасувати пошук
          </Btn>
        </Sheet>
      </div>
    </div>
  )
}
