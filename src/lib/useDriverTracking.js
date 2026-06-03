import { useEffect, useState } from 'react'
import { useTrip } from '../state/TripContext'

// Хук для екранів водія в дорозі (Navigate, DriverTrip):
//  • Screen Wake Lock — екран не гасне (з re-request на visibilitychange);
//  • geolocation.watchPosition — позиція летить у realtime (зараз заглушка,
//    у проді — на сервер).
//
// PWA-обмеження: при заблокованому екрані iOS трекінг паузиться. Для MVP ок.
export function useDriverTracking({ enabled = true } = {}) {
  const { realtime } = useTrip()
  const [permission, setPermission] = useState('unknown') // unknown | granted | denied
  const [speed, setSpeed] = useState(0) // km/h
  const [coord, setCoord] = useState(null) // [lng,lat] реальна позиція
  const [heading, setHeading] = useState(0)

  useEffect(() => {
    if (!enabled) return

    let wakeLock = null
    let cancelled = false

    async function requestWakeLock() {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen')
        }
      } catch {
        /* wake lock недоступний — не критично */
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') requestWakeLock()
    }

    requestWakeLock()
    document.addEventListener('visibilitychange', onVisibility)

    // Геолокація.
    let watchId = null
    if ('geolocation' in navigator) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (cancelled) return
          setPermission('granted')
          const { longitude, latitude, speed: spd, heading: hd } = pos.coords
          if (typeof spd === 'number' && !Number.isNaN(spd)) {
            setSpeed(Math.max(0, Math.round(spd * 3.6)))
          }
          const c = [longitude, latitude]
          const h = hd ?? 0
          setCoord(c)
          setHeading(h)
          // Реальні координати → realtime (сервер ретранслює замовнику).
          realtime.emit('driver:location', { coord: c, heading: h })
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) setPermission('denied')
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
      )
    }

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
      if (wakeLock) wakeLock.release().catch(() => {})
    }
  }, [enabled, realtime])

  return { permission, speed, coord, heading }
}
