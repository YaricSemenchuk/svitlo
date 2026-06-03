import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MAP_STYLE, fetchRoute, cumulative, pointAt, bearing } from '../lib/maps'

// MapLibre-карта з маршрутом, маркерами та двома режимами руху авто:
//  • demo (нема пропа car): авто саме їде по маршруту start→pickup циклічно;
//  • controlled (є car): позиція береться з пропсів (realtime-дані).
//
// Камера:
//  • role:'rider'  — fitBounds([car,pickup]);
//  • role:'driver' — режим навігатора: easeTo з нахилом і поворотом за рухом.
export default function LiveMap({
  role = 'rider',
  start,
  pickup,
  dest,
  car = null,
  durationMs = 15000,
  onProgress,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const loadedRef = useRef(false)
  const markersRef = useRef({})
  const rafRef = useRef(null)
  const routeRef = useRef(null) // { coords, cum }
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress

  // ── ініціалізація карти (один раз) ──
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: start || [30.5236, 50.4476],
      zoom: 14,
      pitch: role === 'driver' ? 55 : 0,
      attributionControl: true,
    })
    mapRef.current = map

    map.on('load', () => {
      loadedRef.current = true

      // Активний маршрут (лаймова лінія).
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
      })
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#c8ff3d', 'line-width': 6 },
      })

      // Приглушений пунктир pickup→dest.
      map.addSource('route-dim', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
      })
      map.addLayer({
        id: 'route-dim',
        type: 'line',
        source: 'route-dim',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#c8ff3d',
          'line-width': 3,
          'line-opacity': 0.3,
          'line-dasharray': [1, 3],
        },
      })

      // Маркери.
      if (pickup) {
        markersRef.current.pickup = makeMarker('mk-diamond')
          .setLngLat(pickup)
          .addTo(map)
      }
      const carEl = role === 'driver' ? 'mk-me' : 'mk-car'
      markersRef.current.car = makeMarker(carEl)
        .setLngLat(car?.coord || start || pickup)
        .addTo(map)

      setupGeometry()
    })

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      map.remove()
      mapRef.current = null
      loadedRef.current = false
      markersRef.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── будуємо геометрію коли змінюються точки ──
  useEffect(() => {
    if (loadedRef.current) setupGeometry()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(start), JSON.stringify(pickup), JSON.stringify(dest), role, !!car])

  async function setupGeometry() {
    const map = mapRef.current
    if (!map || !loadedRef.current) return

    // Активний сегмент: для in_trip (start≈pickup) показуємо pickup→dest,
    // інакше start→pickup.
    const segStart = start
    const segEnd = pickup || dest

    if (segStart && segEnd) {
      const coords = await fetchRoute(segStart, segEnd)
      routeRef.current = { coords, cum: cumulative(coords) }
      const src = map.getSource('route')
      if (src)
        src.setData({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
        })
    }

    // Пунктир pickup→dest (прев'ю подальшого шляху).
    if (pickup && dest) {
      const dim = await fetchRoute(pickup, dest)
      const src = map.getSource('route-dim')
      if (src)
        src.setData({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: dim },
        })
    }

    // Demo-режим: авто саме їде по маршруту.
    if (!car) startDemoDrive()
    else applyControlled(car)
  }

  // ── controlled: позиція з пропсів ──
  useEffect(() => {
    if (car && loadedRef.current) applyControlled(car)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [car?.coord?.[0], car?.coord?.[1], car?.heading])

  function applyControlled(c) {
    const map = mapRef.current
    const m = markersRef.current.car
    if (!map || !m || !c?.coord) return
    m.setLngLat(c.coord)
    if (role === 'rider' && pickup) {
      map.fitBounds([c.coord, pickup], {
        padding: { top: 120, bottom: 280, left: 60, right: 60 },
        duration: 600,
        maxZoom: 16,
      })
    } else if (role === 'driver') {
      map.easeTo({
        center: c.coord,
        bearing: c.heading ?? 0,
        pitch: 55,
        zoom: 16.5,
        duration: 250,
      })
    }
  }

  function startDemoDrive() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const map = mapRef.current
    const route = routeRef.current
    if (!map || !route || route.coords.length < 2) return
    const total = route.cum[route.cum.length - 1] || 1
    let startTs = null

    const step = (ts) => {
      if (!startTs) startTs = ts
      const elapsed = (ts - startTs) % durationMs
      const p = elapsed / durationMs
      const { coord, heading } = pointAt(route.coords, route.cum, p * total)
      const m = markersRef.current.car
      if (m) m.setLngLat(coord)

      if (role === 'driver') {
        map.easeTo({ center: coord, bearing: heading, pitch: 55, zoom: 16.5, duration: 200 })
      }
      if (onProgressRef.current) {
        const remaining = (1 - p) * total
        onProgressRef.current(p, { heading, km: remaining / 1000, coord })
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }

  return <div className="map-layer" ref={containerRef} />
}

function makeMarker(className) {
  const el = document.createElement('div')
  el.className = className
  return new maplibregl.Marker({ element: el })
}
