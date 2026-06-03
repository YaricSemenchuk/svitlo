import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { createRealtime } from '../lib/realtime'
import { PLACES } from '../lib/maps'
import { apiMe, getToken, setToken } from '../lib/api'

const TripContext = createContext(null)

// ── Профілі (реєстрація) зберігаються в localStorage ──
const PROFILES_KEY = 'svitlo.profiles'
function loadProfiles() {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY)) || { rider: null, driver: null }
  } catch {
    return { rider: null, driver: null }
  }
}

// ── Сесія активної поїздки зберігається в sessionStorage,
//    щоб переживати оновлення сторінки (refresh) ──
const RIDE_KEY = 'svitlo.ride'
const RIDE_FIELDS = [
  'role',
  'status',
  'rideId',
  'from',
  'to',
  'fare',
  'pickupCoord',
  'destCoord',
  'driverStartCoord',
  'carCoord',
  'carHeading',
  'driver',
  'rider',
]
function loadRide() {
  try {
    const r = JSON.parse(sessionStorage.getItem(RIDE_KEY))
    return r && r.status && r.status !== 'idle' ? r : null
  } catch {
    return null
  }
}
function saveRide(state) {
  try {
    if (!state.rideId || state.status === 'idle') {
      sessionStorage.removeItem(RIDE_KEY)
      return
    }
    const snap = {}
    RIDE_FIELDS.forEach((k) => (snap[k] = state[k]))
    sessionStorage.setItem(RIDE_KEY, JSON.stringify(snap))
  } catch {
    /* ignore */
  }
}

// Стани поїздки:
// idle → requesting → matching → assigned → arriving → arrived → in_trip → completed
const initialState = {
  role: null, // 'rider' | 'driver'
  status: 'idle',
  from: 'вул. Хрещатик, 22',
  to: 'Аеропорт «Бориспіль»',
  fromCoord: PLACES.pickup, // [lng,lat] обраної адреси подачі (демо-дефолт)
  toCoord: PLACES.dest, // [lng,lat] обраної адреси призначення (демо-дефолт)
  // Резолвлені координати поточної поїздки (з обраних адрес або демо-фолбек):
  pickupCoord: PLACES.pickup,
  destCoord: PLACES.dest,
  driverStartCoord: PLACES.driverStart,
  rideClass: 'comfort', // economy | comfort | business
  prefs: { silent: true, baggage: false, noSmoke: true },
  fare: 248,
  offers: [], // оффери водіїв на аукціоні
  driver: null,
  rider: null,
  carCoord: PLACES.driverStart, // [lng,lat]
  carHeading: 0,
  ref: null, // атрибуція водія з ?ref=
  profiles: { rider: null, driver: null }, // зареєстровані профілі
  auth: { phone: null, loggedIn: false }, // сесія користувача
  rideId: null, // id активної поїздки (WebSocket)
  driversOnline: 0, // скільки водіїв онлайн на момент замовлення
  rideTaken: false, // водій не встиг прийняти (поїздку взяв інший)
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_ROLE':
      return { ...state, role: action.role }

    case 'SET_REF':
      return { ...state, ref: action.ref }

    case 'SET_SESSION':
      // Логін/реєстрація: профілі + телефон із сервера.
      return {
        ...state,
        profiles: action.profiles || { rider: null, driver: null },
        auth: { phone: action.phone || null, loggedIn: true },
      }

    case 'LOGOUT':
      return {
        ...state,
        profiles: { rider: null, driver: null },
        auth: { phone: null, loggedIn: false },
      }

    case 'SET_PROFILE':
      return {
        ...state,
        profiles: { ...state.profiles, [action.role]: action.profile },
      }

    case 'SET_CLASS':
      return { ...state, rideClass: action.rideClass, fare: action.fare }

    case 'SET_FROM':
      // coord передається при виборі підказки/геолокації; при ручному вводі — скидаємо.
      return { ...state, from: action.value, fromCoord: action.coord ?? null }

    case 'SET_TO':
      return { ...state, to: action.value, toCoord: action.coord ?? null }

    case 'SET_FARE':
      return { ...state, fare: action.fare }

    case 'ADJUST_FARE':
      // Дельта рахується від актуального стану — стійко до батчингу швидких тапів.
      return { ...state, fare: Math.max(60, (state.fare || 0) + action.delta) }

    case 'TOGGLE_PREF':
      return {
        ...state,
        prefs: { ...state.prefs, [action.key]: !state.prefs[action.key] },
      }

    case 'CREATE_RIDE': {
      const pickupCoord = action.pickupCoord || PLACES.pickup
      const destCoord = action.destCoord || PLACES.dest
      const driverStartCoord = action.driverStartCoord || PLACES.driverStart
      return {
        ...state,
        status: 'matching',
        fare: action.fare ?? state.fare,
        offers: [],
        driver: null,
        rideTaken: false,
        pickupCoord,
        destCoord,
        driverStartCoord,
        carCoord: driverStartCoord,
      }
    }

    case 'SET_RIDE_META':
      return { ...state, rideId: action.rideId, driversOnline: action.driversOnline ?? 0 }

    case 'SET_DRIVERS_ONLINE':
      return { ...state, driversOnline: action.driversOnline ?? 0 }

    case 'ASSIGNED':
      // Водій отримав поїздку: координати маршруту + дані замовника.
      return {
        ...state,
        status: 'arriving',
        rideId: action.rideId,
        rider: action.rider || state.rider,
        from: action.from || state.from,
        to: action.to || state.to,
        fare: action.fare ?? state.fare,
        pickupCoord: action.pickupCoord || PLACES.pickup,
        destCoord: action.destCoord || PLACES.dest,
        driverStartCoord: action.driverStartCoord || PLACES.driverStart,
        carCoord: action.driverStartCoord || PLACES.driverStart,
      }

    case 'TRIP_STARTED':
      return { ...state, status: 'in_trip' }

    case 'RIDE_TAKEN':
      return { ...state, rideTaken: true, status: 'idle' }

    case 'RECEIVE_OFFER':
      return { ...state, offers: [...state.offers, action.offer] }

    case 'SELECT_OFFER':
      // Узгоджена ціна = ціна обраного водія.
      return {
        ...state,
        status: 'arriving',
        driver: action.driver,
        fare: action.driver.price ?? state.fare,
        offers: [],
        carCoord: action.driver.startCoord || state.driverStartCoord,
      }

    case 'MATCHED':
      return { ...state, status: 'arriving', driver: action.driver }

    case 'CAR_LOCATION':
      return {
        ...state,
        carCoord: action.coord,
        carHeading: action.heading ?? state.carHeading,
      }

    case 'ARRIVED':
      return { ...state, status: 'arrived' }

    case 'START_TRIP':
      return { ...state, status: 'in_trip' }

    case 'COMPLETE':
      return { ...state, status: 'completed' }

    case 'RECEIVE_REQUEST':
      return {
        ...state,
        status: 'requesting',
        rideId: action.rideId || state.rideId,
        rideTaken: false,
        rider: action.rider,
        fare: action.fare ?? state.fare,
        // Адреси з пропозиції пасажира (фолбек — демо-маршрут).
        from: action.from || 'вул. Хрещатик, 22',
        to: action.to || 'Аеропорт «Бориспіль»',
        // Реальні координати маршруту.
        pickupCoord: action.pickupCoord || PLACES.pickup,
        destCoord: action.destCoord || PLACES.dest,
        driverStartCoord: action.driverStartCoord || PLACES.driverStart,
        carCoord: action.driverStartCoord || PLACES.driverStart,
      }

    case 'ACCEPT_REQUEST':
      return { ...state, status: 'arriving', carCoord: PLACES.driverStart }

    case 'RESET':
      return {
        ...initialState,
        role: state.role,
        ref: state.ref,
        rideClass: state.rideClass,
        prefs: state.prefs,
        fare: state.fare,
        profiles: state.profiles, // профілі не скидаємо
        auth: state.auth, // сесію не скидаємо
      }

    default:
      return state
  }
}

export function TripProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => ({
    ...init,
    profiles: loadProfiles(),
    ...(loadRide() || {}), // відновлюємо активну поїздку після refresh
  }))
  const rtRef = useRef(null)

  if (!rtRef.current) rtRef.current = createRealtime()
  const realtime = rtRef.current

  // Дзеркало сесії для обробника reconnect (щоб не залежати від замикання).
  const sessionRef = useRef({ rideId: null, role: null, status: 'idle' })
  sessionRef.current = { rideId: state.rideId, role: state.role, status: state.status }

  // Зберігаємо профілі в localStorage (кеш на випадок офлайну).
  useEffect(() => {
    try {
      localStorage.setItem(PROFILES_KEY, JSON.stringify(state.profiles))
    } catch {
      /* ignore */
    }
  }, [state.profiles])

  // Зберігаємо сесію активної поїздки (переживає refresh).
  useEffect(() => {
    saveRide(state)
  }, [
    state.status,
    state.rideId,
    state.carCoord,
    state.driver,
    state.rider,
    state.pickupCoord,
    state.destCoord,
  ])

  // На старті, якщо є токен — підтягуємо профілі з сервера (джерело правди).
  useEffect(() => {
    const token = getToken()
    if (!token) return
    apiMe(token)
      .then(({ user }) =>
        dispatch({ type: 'SET_SESSION', phone: user.phone, profiles: user.profiles })
      )
      .catch(() => setToken(null)) // токен протух — виходимо
  }, [])

  // Мапимо realtime-події в dispatch. Це єдиний місток між сервером і UI.
  useEffect(() => {
    realtime.connect()
    const offs = [
      // WebSocket (пере)підключився — відновлюємо активну поїздку на сервері.
      realtime.on('rt:open', () => {
        const s = sessionRef.current
        if (s.rideId && s.status !== 'idle' && s.status !== 'completed') {
          realtime.emit('ride:resume', { rideId: s.rideId, role: s.role })
        }
      }),
      // Поїздку на сервері втрачено (напр. сервер перезапустився) → скидаємо.
      realtime.on('ride:gone', () => dispatch({ type: 'RESET' })),
      realtime.on('ride:resumed', () => {}),
      // Замовник створив поїздку.
      realtime.on('ride:created', (p) =>
        dispatch({ type: 'SET_RIDE_META', rideId: p.rideId, driversOnline: p.driversOnline })
      ),
      // Лічильник онлайн-водіїв оновився під час пошуку.
      realtime.on('drivers:count', (p) =>
        dispatch({ type: 'SET_DRIVERS_ONLINE', driversOnline: p.driversOnline })
      ),
      // Замовнику: водія знайдено.
      realtime.on('ride:matched', (p) => dispatch({ type: 'MATCHED', driver: p.driver })),
      // Водію: поїздку призначено.
      realtime.on('ride:assigned', (p) =>
        dispatch({
          type: 'ASSIGNED',
          rideId: p.rideId,
          rider: p.rider,
          from: p.fromLabel,
          to: p.toLabel,
          fare: p.fare,
          pickupCoord: p.pickup,
          destCoord: p.dest,
          driverStartCoord: p.driverStart,
        })
      ),
      // Водій не встиг — поїздку взяв інший.
      realtime.on('ride:taken', () => dispatch({ type: 'RIDE_TAKEN' })),
      // Позиція водія → замовнику.
      realtime.on('driver:location', (p) =>
        dispatch({ type: 'CAR_LOCATION', coord: p.coord, heading: p.heading })
      ),
      // Водій прибув.
      realtime.on('ride:status', (p) => {
        if (p.status === 'arrived') dispatch({ type: 'ARRIVED' })
      }),
      // Пасажир підтвердив посадку → водію почати рух.
      realtime.on('ride:start', () => dispatch({ type: 'TRIP_STARTED' })),
      // Поїздку завершено.
      realtime.on('ride:complete', () => dispatch({ type: 'COMPLETE' })),
      // Інша сторона скасувала.
      realtime.on('ride:cancel', () => dispatch({ type: 'RESET' })),
      // Водію: вхідний запит.
      realtime.on('ride:request', (p) =>
        dispatch({
          type: 'RECEIVE_REQUEST',
          rideId: p.rideId,
          rider: p.rider,
          fare: p.fare,
          from: p.fromLabel,
          to: p.toLabel,
          pickupCoord: p.pickup,
          destCoord: p.dest,
          driverStartCoord: p.driverStart,
        })
      ),
    ]
    return () => {
      offs.forEach((off) => off && off())
      realtime.disconnect()
    }
  }, [realtime])

  const value = useMemo(() => ({ state, dispatch, realtime }), [state, realtime])
  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}

export function useTrip() {
  const ctx = useContext(TripContext)
  if (!ctx) throw new Error('useTrip must be used within TripProvider')
  return ctx
}
