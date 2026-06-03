// Атоми дизайн-системи «Utilitarian Tech». Усі кольори/радіуси — з theme.css.

export function TopBar({ left, right, variant }) {
  return (
    <div className={`topbar${variant === 'warn' ? ' warn' : ''}`}>
      <span className="left">{left}</span>
      <span className="right">{right}</span>
    </div>
  )
}

export function Sheet({ children }) {
  return <div className="sheet">{children}</div>
}

export function BarHead({ left, right }) {
  return (
    <div className="bar-head">
      <span className="bh-left">{left}</span>
      <span className="bh-right">{right}</span>
    </div>
  )
}

export function NavBanner({ arrow, title, sub }) {
  return (
    <div className="nav-banner">
      <span className="arrow">{arrow}</span>
      <div>
        <div className="nb-title">{title}</div>
        {sub && <div className="nb-sub">{sub}</div>}
      </div>
    </div>
  )
}

export function Avatar({ label, kind = 'driver' }) {
  return <div className={`avatar ${kind}`}>{label}</div>
}

export function Chip({ on, children }) {
  return <span className={`chip${on ? ' on' : ''}`}>{children}</span>
}

export function Row({ tag, v, x }) {
  return (
    <div className="row">
      {tag && <span className="row-tag">{tag}</span>}
      <span className="row-v">{v}</span>
      {x != null && <span className="row-x">{x}</span>}
    </div>
  )
}

export function Btn({ variant = 'primary', children, ...rest }) {
  return (
    <button className={`btn ${variant}`} {...rest}>
      {children}
    </button>
  )
}

export function Metric({ k, v }) {
  return (
    <div className="metric">
      <span className="m-k">{k}</span>
      <span className="m-v">{v}</span>
    </div>
  )
}

export function Metrics({ children }) {
  return <div className="metrics">{children}</div>
}

export function Progress({ value = 0 }) {
  return (
    <div className="progress">
      <i style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  )
}

export function Plate({ children }) {
  return <span className="plate">{children}</span>
}

// Кільце-таймер для екрана запиту водія.
export function TimerRing({ value, max = 12 }) {
  const size = 56
  const r = 24
  const c = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(1, value / max))
  return (
    <div className="ring">
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#24241d" strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#c8ff3d"
          strokeWidth="4"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          strokeLinecap="round"
        />
      </svg>
      <span className="ring-num">{value}</span>
    </div>
  )
}
