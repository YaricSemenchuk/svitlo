// Реальний WebSocket-клієнт. Той самий інтерфейс, що й раніше:
// connect / disconnect / on / emit — тож екрани й TripContext не змінюються.
//
// Зʼєднання: wss://<host>/ws?token=<JWT>. Сервер (server.js) звʼязує
// замовника й водія в одній поїздці та ретранслює координати/статуси.
import { getToken } from './api'

export function createRealtime() {
  const listeners = new Map()
  let ws = null
  let closed = false
  let rideId = null
  const queue = [] // повідомлення, надіслані до встановлення зʼєднання

  const fire = (event, payload) => {
    const set = listeners.get(event)
    if (set) set.forEach((cb) => cb(payload))
  }

  // Події, до яких автоматично додаємо поточний rideId.
  const NEEDS_RIDE = new Set([
    'driver:location',
    'ride:status',
    'ride:start',
    'ride:complete',
    'ride:cancel',
  ])

  function wsUrl() {
    const token = getToken() || ''
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`
  }

  function open() {
    if (closed) return
    try {
      ws = new WebSocket(wsUrl())
    } catch {
      return
    }
    ws.onopen = () => {
      while (queue.length) ws.send(queue.shift())
    }
    ws.onmessage = (e) => {
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      const { event, payload } = msg
      // Запамʼятовуємо rideId з ключових подій.
      if (payload?.rideId) {
        if (['ride:created', 'ride:assigned', 'ride:matched', 'ride:request'].includes(event))
          rideId = payload.rideId
      }
      fire(event, payload)
    }
    ws.onclose = () => {
      ws = null
      if (!closed) setTimeout(open, 1500) // авто-реконект
    }
    ws.onerror = () => ws && ws.close()
  }

  const api = {
    connect() {
      closed = false
      open()
      return api
    },
    disconnect() {
      closed = true
      if (ws) ws.close()
      ws = null
      return api
    },
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(cb)
      return () => listeners.get(event)?.delete(cb)
    },
    emit(event, payload = {}) {
      const p = { ...payload }
      if (NEEDS_RIDE.has(event) && rideId && !p.rideId) p.rideId = rideId
      // ride:accept несе свій rideId (з вхідного запиту) — нічого не додаємо.
      const raw = JSON.stringify({ event, payload: p })
      if (ws && ws.readyState === 1) ws.send(raw)
      else queue.push(raw)
      return api
    },
    // Поточний rideId (для діагностики/екранів за потреби).
    get rideId() {
      return rideId
    },
  }

  return api
}
