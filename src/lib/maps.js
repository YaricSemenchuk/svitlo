// Геометрія + маршрутизація + темний стиль карти.
// УВАГА: усі координати у форматі MapLibre — [lng, lat].

// Готовий тёмний векторний стиль без ключа (CARTO Dark Matter). Підтримує pitch.
// Альтернатива у проді: OpenFreeMap (https://openfreemap.org) або MapTiler зі своїм ключем —
// просто заміни URL на свій style.json.
export const MAP_STYLE =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// Ключові точки Києва у форматі [lng, lat].
export const PLACES = {
  driverStart: [30.51618, 50.45295],
  pickup: [30.5236, 50.4476], // вул. Хрещатик, 22
  dest: [30.8946, 50.3449], // аеропорт «Бориспіль»
}

const R = 6371000 // радіус Землі, м
const rad = (d) => (d * Math.PI) / 180
const deg = (r) => (r * 180) / Math.PI

// Відстань між двома [lng,lat] у метрах.
export function haversine(a, b) {
  const [lng1, lat1] = a
  const [lng2, lat2] = b
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// Азимут руху з a до b у градусах (0 = північ, за годинниковою).
export function bearing(a, b) {
  const [lng1, lat1] = a
  const [lng2, lat2] = b
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2))
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1))
  return (deg(Math.atan2(y, x)) + 360) % 360
}

// Кумулятивні дистанції вздовж полілінії. Повертає [0, d1, d1+d2, ...].
export function cumulative(coords) {
  const cum = [0]
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]))
  }
  return cum
}

// Точка на відстані d (м) уздовж маршруту + heading у цій точці.
export function pointAt(coords, cum, d) {
  if (coords.length === 0) return { coord: [0, 0], heading: 0 }
  if (coords.length === 1) return { coord: coords[0], heading: 0 }
  const total = cum[cum.length - 1]
  const dist = Math.max(0, Math.min(d, total))

  // Знайти сегмент.
  let i = 1
  while (i < cum.length && cum[i] < dist) i++
  if (i >= coords.length) i = coords.length - 1

  const a = coords[i - 1]
  const b = coords[i]
  const segLen = cum[i] - cum[i - 1] || 1
  const t = (dist - cum[i - 1]) / segLen
  const coord = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  return { coord, heading: bearing(a, b) }
}

// Центр Києва — для зміщення підказок геокодера.
export const KYIV_CENTER = [30.5234, 50.4501]

// Точка старту водія неподалік від точки подачі (≈1.5 км на пн.-зх.).
// У проді сюди підставляється реальна позиція найближчого онлайн-водія.
export function nearbyStart(coord) {
  if (!coord) return PLACES.driverStart
  return [coord[0] - 0.013, coord[1] + 0.009]
}

// Геокодер Photon (OpenStreetMap) — безкоштовний, без ключа, зручний для
// автодоповнення. У проді → Google Places / Mapbox Geocoding (та сама сигнатура).
const GEOCODER = 'https://photon.komoot.io'

function fmtPlace(p = {}) {
  const house = [p.street, p.housenumber].filter(Boolean).join(', ')
  const name = p.name || house || p.city || p.county || 'Невідоме місце'
  const detail = []
  if (house && house !== name) detail.push(house)
  if (p.city && p.city !== name) detail.push(p.city)
  else if (p.county && p.county !== name) detail.push(p.county)
  const label = detail.length ? `${name}, ${detail.join(', ')}` : name
  return { name, detail: detail.join(' · '), label }
}

// Пошук адрес для автодоповнення. near=[lng,lat] зміщує результати ближче.
export async function searchPlaces(query, near = KYIV_CENTER) {
  const q = (query || '').trim()
  if (q.length < 3) return []
  try {
    const params = new URLSearchParams({ q, limit: '6' })
    if (near) {
      params.set('lat', near[1])
      params.set('lon', near[0])
    }
    const res = await fetch(`${GEOCODER}/api?${params.toString()}`)
    if (!res.ok) throw new Error('geocode ' + res.status)
    const data = await res.json()
    return (data.features || [])
      .filter((f) => f?.geometry?.coordinates)
      .map((f) => ({ coord: f.geometry.coordinates, ...fmtPlace(f.properties) }))
  } catch {
    return []
  }
}

// Зворотне геокодування: [lng,lat] → адреса (для «моя локація»).
export async function reverseGeocode([lng, lat]) {
  try {
    const res = await fetch(`${GEOCODER}/reverse?lon=${lng}&lat=${lat}`)
    if (!res.ok) throw new Error('reverse ' + res.status)
    const data = await res.json()
    const f = data.features?.[0]
    if (!f) return null
    return { coord: [lng, lat], ...fmtPlace(f.properties) }
  } catch {
    return null
  }
}

// Реальний маршрут по дорогах через OSRM. Повертає масив [lng,lat].
// У проді → Google Directions / Mapbox Directions; сигнатура та сама.
export async function fetchRoute(start, end) {
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${start[0]},${start[1]};${end[0]},${end[1]}` +
      `?overview=full&geometries=geojson`
    const res = await fetch(url)
    if (!res.ok) throw new Error('osrm ' + res.status)
    const data = await res.json()
    const coords = data?.routes?.[0]?.geometry?.coordinates
    if (Array.isArray(coords) && coords.length > 1) return coords
    throw new Error('no route')
  } catch (e) {
    // Фолбек: пряма лінія.
    return [start, end]
  }
}
