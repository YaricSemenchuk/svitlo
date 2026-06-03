// ⭐ WebSocket-заглушка (swappable).
//
// Уся бізнес-логіка реального часу живе ТІЛЬКИ тут. Інтерфейс навмисно
// повторює справжній WebSocket / socket.io-client: on/emit/connect/disconnect.
//
// Щоб під'єднати бойовий бекенд — заміни нутрощі цього файлу на:
//   const ws = new WebSocket(URL)  // або io(URL)
//   ws.onmessage = (e) => fire(JSON.parse(e.data).event, JSON.parse(e.data).payload)
//   emit(event, payload) => ws.send(JSON.stringify({ event, payload }))
// Екрани й TripContext чіпати НЕ треба.

import { fetchRoute, cumulative, pointAt, haversine, PLACES } from './maps'

export function createRealtime() {
  const listeners = new Map() // event -> Set<cb>
  const timers = new Set()
  let driveRAF = null
  let connected = false
  let lastRide = null // остання пропозиція пасажира {from,to,fare}

  const fire = (event, payload) => {
    const set = listeners.get(event)
    if (set) set.forEach((cb) => cb(payload))
  }

  const later = (ms, fn) => {
    const id = setTimeout(() => {
      timers.delete(id)
      if (connected) fn()
    }, ms)
    timers.add(id)
    return id
  }

  // Веде водія по маршруту start→end, шле driver:location ~кожну 1 c,
  // на фініші — ride:status {arrived}.
  async function driveAlong(start, end, { onArriveStatus } = {}) {
    const coords = await fetchRoute(start, end)
    const cum = cumulative(coords)
    const total = cum[cum.length - 1] || 1
    const durationMs = 14000 // ~весь шлях до подачі
    const startTs = performance.now()

    cancelDrive()
    const step = () => {
      if (!connected) return
      const elapsed = performance.now() - startTs
      const p = Math.min(1, elapsed / durationMs)
      const { coord, heading } = pointAt(coords, cum, p * total)
      fire('driver:location', { coord, heading })
      if (p >= 1) {
        driveRAF = null
        if (onArriveStatus) fire('ride:status', { status: 'arrived' })
        return
      }
      driveRAF = requestAnimationFrame(step)
    }
    driveRAF = requestAnimationFrame(step)
  }

  function cancelDrive() {
    if (driveRAF) cancelAnimationFrame(driveRAF)
    driveRAF = null
  }

  function clearTimers() {
    timers.forEach((id) => clearTimeout(id))
    timers.clear()
  }

  const api = {
    connect() {
      connected = true
      return api
    },
    disconnect() {
      connected = false
      clearTimers()
      cancelDrive()
      return api
    },
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(cb)
      return () => listeners.get(event)?.delete(cb)
    },
    emit(event, payload) {
      // ── Команди клієнта → симуляція серверних подій ──
      if (event === 'ride:create') {
        // Запам'ятовуємо пропозицію пасажира (адреси + ціна), щоб згодом
        // показати її водієві у вхідному запиті.
        lastRide = payload || null
        // Нова поїздка скасовує будь-яку попередню симуляцію (захист від
        // накладання таймерів, якщо створити поїздку повторно).
        clearTimers()
        cancelDrive()

        // БЕЗ вигаданих водіїв. Оффер дають лише РЕАЛЬНІ водії — ті, що
        // зареєстровані / в мережі (payload.drivers). На цьому пристрої це
        // зареєстрований/онлайн водій. Немає таких — немає офферів.
        const offered = lastRide?.fare ?? 210
        const pickupCoord = lastRide?.pickupCoord || PLACES.pickup
        const drivers = (lastRide?.drivers || []).filter((d) => d?.name)

        drivers.forEach((d, i) => {
          later(1200 + i * 900, () => {
            // ETA та дистанція рахуються від позиції водія до точки подачі.
            const start = d.startCoord || PLACES.driverStart
            const km = +(haversine(start, pickupCoord) / 1000).toFixed(1)
            const etaMin = Math.max(1, Math.round(km / 0.45)) // ~27 км/год у місті
            fire('ride:offer', {
              driver: { ...d, price: Math.max(60, offered), delta: 0, km, etaMin },
            })
          })
        })
      }

      if (event === 'ride:select') {
        // Пасажир обрав водія з офферів → водій виїхав до точки подачі
        // по РЕАЛЬНОМУ маршруту (координати з пропозиції).
        clearTimers() // більше не приймаємо нові оффери
        const start = payload?.driver?.startCoord || lastRide?.driverStartCoord || PLACES.driverStart
        const pickup = lastRide?.pickupCoord || PLACES.pickup
        driveAlong(start, pickup, { onArriveStatus: true })
      }

      if (event === 'ride:accept') {
        // Водій прийняв — нічого додатково симулювати не треба:
        // позицію веде сам екран навігації через driver:location (emit).
      }

      if (event === 'ride:cancel') {
        clearTimers()
        cancelDrive()
      }

      if (event === 'driver:online') {
        clearTimers()
        // Профіль замовника (якщо зареєстрований на пристрої) — інакше демо-пасажир.
        const rider = payload?.riderProfile?.name
          ? payload.riderProfile
          : { name: 'Яр. С.', rating: 4.9, trips: 134, pay: 'A·Pay', initials: 'ЯС', phone: '+380 67 233 90 12' }
        // ~4 c → вхідний запит.
        later(4000, () => {
          fire('ride:request', {
            rider,
            // Реальні координати маршруту з пропозиції пасажира (фолбек — демо).
            pickup: lastRide?.pickupCoord || PLACES.pickup,
            dest: lastRide?.destCoord || PLACES.dest,
            driverStart: lastRide?.driverStartCoord || PLACES.driverStart,
            // Ціна й адреси з пропозиції пасажира.
            fare: lastRide?.fare ?? 210,
            fromLabel: lastRide?.from,
            toLabel: lastRide?.to,
          })
        })
      }

      // driver:location від реального GPS водія (екран навігації) —
      // у заглушці просто ретранслюємо підписникам (echo).
      if (event === 'driver:location') {
        fire('driver:location', payload)
      }

      return api
    },
  }

  return api
}
