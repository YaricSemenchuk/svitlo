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

import { fetchRoute, cumulative, pointAt, PLACES } from './maps'

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

        // Аукціон: кілька водіїв відгукуються на пропозицію пасажира.
        // delta = 0 — згоден на вашу ціну; delta > 0 — контрпропозиція.
        const offered = lastRide?.fare ?? 210
        const TEMPLATES = [
          { name: 'Олександр К.', initials: 'ОК', rating: 4.9, trips: 1240, car: 'Škoda Octavia', color: 'сірий', plate: 'АА 7421 ВС', phone: '+380 67 401 22 18', etaMin: 3, km: 1.2, delta: 0 },
          { name: 'Дмитро В.', initials: 'ДВ', rating: 4.8, trips: 870, car: 'VW Passat', color: 'білий', plate: 'АІ 3092 ОР', phone: '+380 50 318 77 04', etaMin: 2, km: 0.8, delta: 25 },
          { name: 'Ірина М.', initials: 'ІМ', rating: 4.97, trips: 2310, car: 'Toyota Camry', color: 'чорний', plate: 'КА 5510 ІК', phone: '+380 63 920 55 61', etaMin: 6, km: 2.4, delta: 50 },
          { name: 'Сергій П.', initials: 'СП', rating: 4.85, trips: 560, car: 'Hyundai Accent', color: 'синій', plate: 'АА 1180 ВН', phone: '+380 98 144 30 96', etaMin: 8, km: 3.6, delta: 0 },
        ]
        // Якщо на пристрої зареєстрований водій — він відгукується першим
        // (за вашою ціною), щоб пасажир бачив його реальні дані: авто, номер, телефон.
        const list = [...TEMPLATES]
        if (lastRide?.driverProfile?.name) {
          list.unshift({ ...lastRide.driverProfile, delta: 0 })
        }
        list.forEach((tpl, i) => {
          later(1200 + i * 1100, () => {
            const { delta = 0, ...driver } = tpl
            fire('ride:offer', {
              driver: { ...driver, price: Math.max(60, offered + delta), delta },
            })
          })
        })
      }

      if (event === 'ride:select') {
        // Пасажир обрав водія з офферів → водій виїхав до точки подачі.
        clearTimers() // більше не приймаємо нові оффери
        driveAlong(PLACES.driverStart, PLACES.pickup, { onArriveStatus: true })
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
            pickup: PLACES.pickup,
            dest: PLACES.dest,
            // Ціна й адреси з пропозиції пасажира (фолбек — демо-значення).
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
