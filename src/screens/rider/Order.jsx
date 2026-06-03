import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Minus, Plus } from 'lucide-react'
import { useTrip } from '../../state/TripContext'
import LiveMap from '../../components/LiveMap'
import AddressField from '../../components/AddressField'
import { PLACES, KYIV_CENTER, reverseGeocode, nearbyStart, fetchRouteInfo } from '../../lib/maps'
import { TopBar, Sheet, BarHead, Metric, Metrics, Chip, Btn } from '../../components/ui'

const MIN_FARE = 60
const STEP = 10

// Рекомендована ціна за дистанцією: база + за км (калібровано під ринок Києва).
const recommendFor = (km) => Math.max(MIN_FARE, Math.round((40 + km * 6) / 5) * 5)

// Короткий лейбл способу оплати для метрики PAY.
const PAY_SHORT = {
  'Apple Pay': 'A·PAY',
  'Google Pay': 'G·PAY',
  'Картка (Mono)': 'КАРТКА',
  Готівка: 'ГОТІВКА',
}

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

  // Метрики маршруту (DIST/TIME) рахуються по дорогах за обраними координатами
  // і оновлюються щоразу, коли пасажир змінює адресу.
  const [route, setRoute] = useState(null) // { km, min } | null
  const lastKey = useRef(null)
  useEffect(() => {
    const a = state.fromCoord
    const b = state.toCoord
    if (!a || !b) {
      setRoute(null)
      return
    }
    const key = a.join(',') + '|' + b.join(',')
    if (key === lastKey.current) return
    lastKey.current = key
    let alive = true
    fetchRouteInfo(a, b).then((info) => {
      if (!alive) return
      setRoute(info)
      // Рекомендована ціна підлаштовується під новий маршрут.
      dispatch({ type: 'SET_FARE', fare: recommendFor(info.km) })
    })
    return () => {
      alive = false
    }
  }, [state.fromCoord, state.toCoord, dispatch])

  // Рекомендована ціна — за реальною дистанцією (або фолбек).
  const base = route ? recommendFor(route.km) : 248
  const fare = state.fare || 0

  // Скільки реальних водіїв доступно (зареєстрований/онлайн на пристрої).
  const driversNearby = state.profiles.driver ? 1 : 0
  const payLabel = PAY_SHORT[state.profiles.rider?.pay] || 'A·PAY'
  const fromShort = (state.from || 'KYIV').split(',')[0].trim().toUpperCase().slice(0, 22)

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

    dispatch({ type: 'SET_FARE', fare: finalFare })
    dispatch({ type: 'CREATE_RIDE', fare: finalFare, pickupCoord, destCoord, driverStartCoord })
    // Реальний WebSocket: запит іде всім онлайн-водіям; перший, хто прийме, везе.
    realtime.emit('ride:create', {
      from: state.from,
      to: state.to,
      pickupCoord,
      destCoord,
      driverStartCoord,
      fare: finalFare,
      profile: state.profiles.rider,
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
        <TopBar
          left={`● ${fromShort}`}
          right={driversNearby ? `${driversNearby} авто поблизу` : 'немає авто поблизу'}
        />
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
            <Metric k="DIST" v={route ? `${route.km.toFixed(1)} km` : '—'} />
            <Metric k="TIME" v={route ? `~${Math.round(route.min)} min` : '—'} />
            <Metric k="PAY" v={payLabel} />
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
