import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Minus, Plus } from 'lucide-react'
import { useTrip } from '../../state/TripContext'
import LiveMap from '../../components/LiveMap'
import AddressField from '../../components/AddressField'
import { PLACES, KYIV_CENTER, reverseGeocode, nearbyStart } from '../../lib/maps'
import { TopBar, Sheet, BarHead, Metric, Metrics, Chip, Btn } from '../../components/ui'

const RECOMMENDED = 248 // рекомендована ціна — орієнтир для підказки
const MIN_FARE = 60
const STEP = 10

export default function Order() {
  const nav = useNavigate()
  const { state, dispatch, realtime } = useTrip()
  const [geoState, setGeoState] = useState('idle') // idle | loading | denied

  // «Моя локація»: геолокація → зворотне геокодування → поле FROM.
  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setGeoState('denied')
      return
    }
    setGeoState('loading')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coord = [pos.coords.longitude, pos.coords.latitude]
        const place = await reverseGeocode(coord)
        dispatch({
          type: 'SET_FROM',
          value: place?.label || 'Моя поточна локація',
          coord,
        })
        setGeoState('idle')
      },
      () => setGeoState('denied'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    )
  }

  // Зміщення підказок ближче до точки подачі (або центр Києва).
  const near = state.fromCoord || KYIV_CENTER

  // Рекомендована ціна — орієнтир. Пасажир пропонує свою.
  const base = RECOMMENDED
  const fare = state.fare || 0

  const setFare = (v) => dispatch({ type: 'SET_FARE', fare: Math.max(MIN_FARE, v) })
  const step = (d) => dispatch({ type: 'ADJUST_FARE', delta: d })
  const onPriceInput = (e) => {
    const n = parseInt(e.target.value.replace(/\D/g, ''), 10)
    dispatch({ type: 'SET_FARE', fare: Number.isNaN(n) ? 0 : n })
  }
  const onPriceBlur = () => {
    if (!state.fare || state.fare < MIN_FARE) setFare(MIN_FARE)
  }

  const togglePref = (key) => dispatch({ type: 'TOGGLE_PREF', key })

  const order = () => {
    const finalFare = Math.max(MIN_FARE, state.fare || base)
    // Резолвимо координати маршруту з обраних адрес (або демо-фолбек).
    const pickupCoord = state.fromCoord || PLACES.pickup
    const destCoord = state.toCoord || PLACES.dest
    const driverStartCoord = nearbyStart(pickupCoord)

    // Кандидати-водії — ЛИШЕ реальні (зареєстрований/онлайн на цьому пристрої).
    // Жодних вигаданих. Немає водія — пасажир побачить «немає вільних поблизу».
    const drivers = state.profiles.driver
      ? [{ ...state.profiles.driver, startCoord: driverStartCoord }]
      : []

    dispatch({ type: 'SET_FARE', fare: finalFare })
    dispatch({ type: 'CREATE_RIDE', fare: finalFare, pickupCoord, destCoord, driverStartCoord })
    realtime.emit('ride:create', {
      from: state.from,
      to: state.to,
      fromCoord: state.fromCoord,
      toCoord: state.toCoord,
      pickupCoord,
      destCoord,
      driverStartCoord,
      fare: finalFare,
      drivers,
    })
    nav('/rider/matching')
  }

  // Підказка про відхилення від рекомендованої ціни.
  const diff = fare - base
  let hint = { cls: '', text: `РЕКОМЕНДОВАНО ${base} ₴` }
  if (diff > 0) hint = { cls: 'up', text: `+${diff} ₴ ДО РЕКОМЕНДОВАНОЇ · ШВИДША ПОДАЧА` }
  else if (diff < 0) hint = { cls: 'down', text: `${diff} ₴ ВІД РЕКОМЕНДОВАНОЇ · ПОШУК ДОВШЕ` }

  return (
    <div className="screen">
      <LiveMap
        role="rider"
        start={state.fromCoord || PLACES.pickup}
        pickup={state.toCoord || PLACES.driverStart}
      />

      <div className="float-top">
        <TopBar left="● KYIV / PECHERSK" right="6 авто поблизу" />
      </div>

      <div className="float-bottom">
        <Sheet>
          <BarHead left="ORDER · NEW" right="SURGE ×1.0" />

          {/* Адреси: геолокація + автодоповнення */}
          <AddressField
            tag="FROM"
            value={state.from}
            placeholder="Звідки їдемо?"
            near={near}
            onText={(v) => dispatch({ type: 'SET_FROM', value: v })}
            onPick={(s) => dispatch({ type: 'SET_FROM', value: s.label, coord: s.coord })}
            geo={{ onClick: useMyLocation, state: geoState }}
            autoGeo
          />
          <AddressField
            tag="TO"
            value={state.to}
            placeholder="Куди їдемо?"
            near={near}
            onText={(v) => dispatch({ type: 'SET_TO', value: v })}
            onPick={(s) => dispatch({ type: 'SET_TO', value: s.label, coord: s.coord })}
          />

          {/* Пропозиція ціни */}
          <div className="price-editor">
            <div className="tag">// ВАША ЦІНА</div>
            <div className="price-stepper">
              <button className="step-btn" onClick={() => step(-STEP)} aria-label="менше">
                <Minus size={20} />
              </button>
              <div className="price-field">
                <input
                  inputMode="numeric"
                  value={fare || ''}
                  onChange={onPriceInput}
                  onBlur={onPriceBlur}
                  aria-label="ціна"
                />
                <span className="cur">₴</span>
              </div>
              <button className="step-btn" onClick={() => step(STEP)} aria-label="більше">
                <Plus size={20} />
              </button>
            </div>
            <div className={`price-hint ${hint.cls}`}>{hint.text}</div>
          </div>

          <Metrics>
            <Metric k="DIST" v="34.2 km" />
            <Metric k="TIME" v="~42 min" />
            <Metric k="PAY" v="A·PAY" />
          </Metrics>

          <div className="chips">
            <Chip on={state.prefs.silent}>
              <button onClick={() => togglePref('silent')} style={{ all: 'unset' }}>
                [{state.prefs.silent ? 'x' : ' '}] silent
              </button>
            </Chip>
            <Chip on={state.prefs.baggage}>
              <button onClick={() => togglePref('baggage')} style={{ all: 'unset' }}>
                [{state.prefs.baggage ? 'x' : ' '}] baggage
              </button>
            </Chip>
            <Chip on={state.prefs.noSmoke}>
              <button onClick={() => togglePref('noSmoke')} style={{ all: 'unset' }}>
                [{state.prefs.noSmoke ? 'x' : ' '}] no-smoke
              </button>
            </Chip>
          </div>

          <Btn variant="primary" onClick={order}>
            {'>'} Запропонувати {Math.max(MIN_FARE, fare || base)} ₴
          </Btn>
        </Sheet>
      </div>
    </div>
  )
}
