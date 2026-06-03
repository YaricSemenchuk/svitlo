import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { createRealtime } from '../lib/realtime'
import { PLACES } from '../lib/maps'

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
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_ROLE':
      return { ...state, role: action.role }

    case 'SET_REF':
      return { ...state, ref: action.ref }

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
        pickupCoord,
        destCoord,
        driverStartCoord,
        carCoord: driverStartCoord,
      }
    }

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
      }

    default:
      return state
  }
}

export function TripProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => ({
    ...init,
    profiles: loadProfiles(),
  }))
  const rtRef = useRef(null)

  if (!rtRef.current) rtRef.current = createRealtime()
  const realtime = rtRef.current

  // Зберігаємо профілі в localStorage при змінах.
  useEffect(() => {
    try {
      localStorage.setItem(PROFILES_KEY, JSON.stringify(state.profiles))
    } catch {
      /* ignore */
    }
  }, [state.profiles])

  // Мапимо realtime-події в dispatch. Це єдиний місток між сервером і UI.
  useEffect(() => {
    realtime.connect()
    const offs = [
      realtime.on('ride:offer', (p) => dispatch({ type: 'RECEIVE_OFFER', offer: p.driver })),
      realtime.on('ride:matched', (p) => dispatch({ type: 'MATCHED', driver: p.driver })),
      realtime.on('driver:location', (p) =>
        dispatch({ type: 'CAR_LOCATION', coord: p.coord, heading: p.heading })
      ),
      realtime.on('ride:status', (p) => {
        if (p.status === 'arrived') dispatch({ type: 'ARRIVED' })
      }),
      realtime.on('ride:request', (p) =>
        dispatch({
          type: 'RECEIVE_REQUEST',
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
