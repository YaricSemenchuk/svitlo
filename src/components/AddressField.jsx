import { useEffect, useRef, useState } from 'react'
import { MapPin, LocateFixed, LoaderCircle } from 'lucide-react'
import { searchPlaces } from '../lib/maps'

// Поле адреси з автодоповненням (Photon) і, опційно, кнопкою геолокації.
// props:
//  tag, value, placeholder
//  near=[lng,lat] — зміщення підказок
//  onText(value)         — ручний ввід (без координат)
//  onPick({label,coord}) — обрана підказка/локація
//  geo: { onClick, state: 'idle'|'loading'|'denied' } — кнопка «моя локація» (лише для FROM)
//  autoGeo — автозапуск геолокації при першому фокусі (порожнє поле)
export default function AddressField({
  tag,
  value,
  placeholder,
  near,
  onText,
  onPick,
  geo,
  autoGeo,
}) {
  const [list, setList] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const tRef = useRef(null)
  const autoFiredRef = useRef(false)

  useEffect(() => () => clearTimeout(tRef.current), [])

  const query = (v) => {
    clearTimeout(tRef.current)
    if (v.trim().length < 3) {
      setList([])
      setOpen(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setOpen(true)
    tRef.current = setTimeout(async () => {
      const res = await searchPlaces(v, near)
      setList(res)
      setLoading(false)
    }, 350)
  }

  const handleInput = (e) => {
    onText(e.target.value)
    query(e.target.value)
  }

  const handleFocus = () => {
    if (autoGeo && geo && !autoFiredRef.current) {
      autoFiredRef.current = true
      geo.onClick()
    }
    if (list.length) setOpen(true)
  }

  const pick = (s) => {
    onPick(s)
    setOpen(false)
    setList([])
  }

  const geoState = geo?.state

  return (
    <div className="addr-field">
      <div className="field-row">
        <span className="row-tag">{tag}</span>
        <input
          className="field-input"
          value={value}
          placeholder={placeholder}
          onChange={handleInput}
          onFocus={handleFocus}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
        />
        {geo && (
          <button
            className={`geo-btn${geoState === 'denied' ? ' denied' : ''}`}
            onClick={geo.onClick}
            aria-label="моя локація"
            type="button"
          >
            {geoState === 'loading' ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <LocateFixed size={18} />
            )}
          </button>
        )}
      </div>

      {open && (loading || list.length > 0) && (
        <div className="suggestions">
          {loading && <div className="sug-info">пошук адрес…</div>}
          {!loading &&
            list.map((s, i) => (
              <button key={i} className="sug" type="button" onMouseDown={() => pick(s)}>
                <MapPin size={14} className="sug-pin" />
                <span className="sug-text">
                  <span className="sug-name">{s.name}</span>
                  {s.detail && <span className="sug-detail">{s.detail}</span>}
                </span>
              </button>
            ))}
        </div>
      )}

      {geoState === 'denied' && tag === 'FROM' && (
        <div className="geo-hint">Доступ до геолокації відхилено — введіть адресу вручну</div>
      )}
    </div>
  )
}
