import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../state/store.ts'
import { toastStore } from '../state/toast.ts'
import s from './ui.module.css'

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}

const RING_STROKE = 3
const RING_GAP = 4

/** One arc per story, lit while it is unread. */
function Ring({ box, unread }: { box: number; unread: boolean[] }) {
  const radius = (box - RING_STROKE) / 2
  const around = 2 * Math.PI * radius
  const slot = around / unread.length
  const arc = Math.max(1, slot - RING_GAP - RING_STROKE)
  return (
    <svg className={s.ring} viewBox={`0 0 ${box} ${box}`} aria-hidden>
      {unread.map((lit, index) => (
        <circle
          key={index}
          className={cx(lit && s.unread)}
          cx={box / 2}
          cy={box / 2}
          r={radius}
          strokeDasharray={unread.length > 1 ? `${arc} ${around - arc}` : undefined}
          strokeDashoffset={-(index * slot + RING_GAP / 2)}
        />
      ))}
    </svg>
  )
}

export function Avatar({
  title,
  icon,
  size = 32,
  ring,
}: {
  title: string
  icon: string | null
  size?: number
  /** Unread state of each recent story, oldest first. */
  ring?: boolean[]
}) {
  const [failed, setFailed] = useState(false)
  const face =
    icon && !failed ? (
      <img className={s.face} src={icon} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    ) : (
      <span className={cx(s.face, s.letter)} aria-hidden>
        {title.trim().charAt(0).toUpperCase()}
      </span>
    )
  return (
    <span className={cx(s.avatar, ring && s.ringed)} style={{ '--size': `${size}px` } as CSSProperties}>
      {ring && ring.length > 0 && <Ring box={size + 14} unread={ring} />}
      {face}
    </span>
  )
}

export function TopBar({ title, back, children }: { title: ReactNode; back?: boolean; children?: ReactNode }) {
  const navigate = useNavigate()
  return (
    <header className={s.topbar}>
      {back && (
        <button className={s.iconButton} onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
      )}
      <h1 className={s.title}>{title}</h1>
      <div className={s.actions}>{children}</div>
    </header>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  )
}

export function Toaster() {
  const current = useStore(toastStore)
  return (
    <div className={s.toaster} role="status" aria-live="polite">
      {current && (
        <div key={current.id} className={s.toast}>
          {current.message}
        </div>
      )}
    </div>
  )
}

export function Menu({ label, trigger, children }: { label: string; trigger: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={s.menu} ref={ref}>
      <button className={s.iconButton} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {trigger}
      </button>
      {open && (
        <div className={s.menuList} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export const ui = s
