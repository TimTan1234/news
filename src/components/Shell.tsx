import { Bell, CircleUser, House, Search, Sparkles } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client.ts'
import { invalidate, useActivityCount, useSources, useTrackers, useTrending } from '../api/hooks.ts'
import { useKey } from '../lib/dom.ts'
import { Avatar, cx, ui } from './ui.tsx'
import s from './shell.module.css'

const NAV = [
  { to: '/', label: 'Home', icon: House },
  { to: '/explore', label: 'Explore', icon: Search },
  { to: '/briefing', label: 'Briefing', icon: Sparkles },
  { to: '/activity', label: 'Activity', icon: Bell },
  { to: '/profile', label: 'Profile', icon: CircleUser },
]

const WIDE_PAGES = ['/explore', '/profile', '/settings']

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx(s.wordmark, className)}>
      <svg className={s.mark} viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
      </svg>
      Pulse
    </span>
  )
}

export function Shell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { data: activity } = useActivityCount()
  const wide = WIDE_PAGES.some((page) => pathname.startsWith(page))

  useKey((event) => {
    const target = event.target as HTMLElement
    if (event.key !== '/' || event.metaKey || event.ctrlKey || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
    event.preventDefault()
    navigate('/explore', { state: { focusSearch: true } })
  })

  return (
    <div className={cx(s.shell, !wide && s.withRail)}>
      <nav className={s.nav} aria-label="Main">
        <Link to="/" className={s.brand}>
          <Wordmark />
        </Link>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx(s.link, isActive && s.active)} aria-label={label}>
            <span className={s.icon}>
              <Icon size={24} />
              {to === '/activity' && !!activity?.unseen && <span className={s.dot} />}
            </span>
            <span className={s.label}>{label}</span>
          </NavLink>
        ))}
      </nav>
      <main className={s.main}>
        <Outlet />
      </main>
      {!wide && <Rail />}
    </div>
  )
}

function Rail() {
  const { data: trends } = useTrending()
  const { data: trackers } = useTrackers()
  const { data: sources } = useSources()
  const suggested = sources?.filter((source) => !source.followed).slice(0, 5) ?? []

  const follow = async (id: number) => {
    await api(`/api/sources/${id}`, { method: 'PATCH', body: { followed: true } })
    invalidate('sources', 'feed', 'stories')
  }

  return (
    <aside className={s.rail}>
      {!!trends?.length && (
        <section>
          <h2 className={s.railTitle}>Trending</h2>
          <ol className={s.trends}>
            {trends.slice(0, 8).map((trend) => (
              <li key={trend.phrase}>
                <Link to={`/explore?q=${encodeURIComponent(trend.phrase)}`} className={s.trend}>
                  <span className={s.trendPhrase}>{trend.phrase}</span>
                  <span className={s.trendMeta}>{trend.sources} sources</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {!!trackers?.length && (
        <section>
          <h2 className={s.railTitle}>Tracking</h2>
          <ul className={s.tracked}>
            {trackers.map((tracker) => (
              <li key={tracker.id}>
                <Link to="/activity" className={cx(ui.chip, tracker.unseen > 0 && s.fresh)}>
                  {tracker.phrase}
                  {tracker.unseen > 0 && <span className={s.count}>{tracker.unseen}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {suggested.length > 0 && (
        <section>
          <h2 className={s.railTitle}>Suggested</h2>
          <ul className={s.suggested}>
            {suggested.map((source) => (
              <li key={source.id} className={s.suggestion}>
                <Link to={`/source/${source.id}`} className={s.suggestionName}>
                  <Avatar title={source.title} icon={source.icon} size={36} />
                  <span>{source.title}</span>
                </Link>
                <button className={s.follow} onClick={() => void follow(source.id)}>
                  Follow
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
