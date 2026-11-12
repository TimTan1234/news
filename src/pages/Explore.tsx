import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useTrending } from '../api/hooks.ts'
import { TileGrid } from '../components/Feed.tsx'
import { Empty, cx, ui } from '../components/ui.tsx'
import p from './pages.module.css'

export function Explore() {
  const [search, setSearch] = useSearchParams()
  const location = useLocation()
  const q = search.get('q') ?? ''
  const [text, setText] = useState(q)
  const input = useRef<HTMLInputElement>(null)
  const { data: trends } = useTrending()

  const apply = (value: string) => {
    const next = new URLSearchParams(search)
    if (value.trim()) next.set('q', value.trim())
    else next.delete('q')
    setSearch(next, { replace: true, state: location.state })
  }

  // Typing settles for a moment before it becomes a search.
  useEffect(() => {
    if (text.trim() === q) return
    const timer = setTimeout(() => apply(text), 300)
    return () => clearTimeout(timer)
  })

  useEffect(() => {
    if ((location.state as { focusSearch?: boolean } | null)?.focusSearch) input.current?.focus()
  }, [location.state])

  const pick = (phrase: string) => {
    setText(phrase)
    apply(phrase)
  }

  return (
    <div className={cx(p.page, p.wide)}>
      <div className={p.searchBar}>
        <label className={p.search}>
          <Search size={18} aria-hidden />
          <input
            ref={input}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search stories"
            aria-label="Search stories"
            enterKeyHint="search"
          />
          {text && (
            <button onClick={() => pick('')} aria-label="Clear search">
              <X size={18} />
            </button>
          )}
        </label>
      </div>
      {!!trends?.length && (
        <div className={p.chips} aria-label="Trending">
          {trends.map((trend) => (
            <button key={trend.phrase} className={cx(ui.chip, q === trend.phrase && ui.chipActive)} onClick={() => pick(trend.phrase)}>
              {trend.phrase}
            </button>
          ))}
        </div>
      )}
      <TileGrid
        params={q ? { q } : {}}
        empty={
          q ? <Empty title={`Nothing matches “${q}”`}>Try a shorter phrase, or track it from Activity to catch it later.</Empty> : <Empty title="No stories yet" />
        }
      />
    </div>
  )
}
