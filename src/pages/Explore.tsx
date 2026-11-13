import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Search, X } from 'lucide-react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { api, errorText, type Source } from '../api/client.ts'
import { invalidate, useFeed, useProviders, useSources, useSuggestions, useTopics, useTrending, useWebSearch } from '../api/hooks.ts'
import { queryClient } from '../api/query.ts'
import { TileGrid } from '../components/Feed.tsx'
import { ArticleRow } from '../components/Row.tsx'
import { SuggestionCard } from '../components/Suggestion.tsx'
import { Empty, cx, ui } from '../components/ui.tsx'
import { messages, useLang, useMessages } from '../i18n/index.ts'
import { useSideScroll } from '../lib/dom.ts'
import { toast } from '../state/toast.ts'
import p from './pages.module.css'

const FEED = 'feed'

export function Explore() {
  const [search, setSearch] = useSearchParams()
  const location = useLocation()
  const q = search.get('q') ?? ''
  const [text, setText] = useState(q)
  const input = useRef<HTMLInputElement>(null)
  const { data: trends } = useTrending()
  const { data: providers } = useProviders()
  const local = useFeed({ q }, { limit: 30, enabled: Boolean(q) })
  const t = useMessages()
  const [chips, setChips] = useState<HTMLDivElement | null>(null)
  useSideScroll(chips)

  // A search that finds nothing in the feed carries straight on to the news, unless a place to look was chosen.
  const localEmpty = local.isSuccess && local.data.pages[0].items.length === 0
  const scope = search.get('in') ?? (q && localEmpty && providers?.length ? providers[0].id : FEED)

  const update = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(search)
    change(next)
    setSearch(next, { replace: true, state: location.state })
  }

  const apply = (value: string) =>
    update((next) => {
      if (value.trim()) next.set('q', value.trim())
      else next.delete('q')
    })

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

  const provider = providers?.find((candidate) => candidate.id === scope)
  const label = (id: string, name: string) => t.explore.providers[id] ?? name

  return (
    <div className={cx(p.page, p.wide)}>
      <div className={p.searchBar}>
        <label className={p.search}>
          <Search size={18} aria-hidden />
          <input
            ref={input}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t.explore.search}
            aria-label={t.explore.search}
            enterKeyHint="search"
          />
          {text && (
            <button onClick={() => pick('')} aria-label={t.explore.clear}>
              <X size={18} />
            </button>
          )}
        </label>
      </div>

      <div className={p.scopes} role="tablist">
        {[{ id: FEED, name: t.explore.yourFeed }, ...(providers ?? [])].map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={scope === item.id}
            className={cx(p.scope, scope === item.id && p.scopeOn)}
            onClick={() => update((next) => next.set('in', item.id))}
          >
            {item.id === FEED ? item.name : label(item.id, item.name)}
          </button>
        ))}
      </div>

      {!q && !provider && !!trends?.length && (
        <div className={p.chips} ref={setChips} aria-label={t.explore.trending}>
          {trends.map((trend) => (
            <button key={trend.phrase} className={ui.chip} onClick={() => pick(trend.phrase)}>
              {trend.phrase}
            </button>
          ))}
        </div>
      )}

      {provider ? (
        q ? (
          <WebResults key={`${provider.id}:${q}`} provider={provider.id} name={label(provider.id, provider.name)} query={q} />
        ) : (
          <Empty title={t.explore.prompt(label(provider.id, provider.name))} />
        )
      ) : (
        <>
          {!q && <ForYou />}
          <TileGrid params={q ? { q } : {}} empty={<Empty title={q ? t.explore.noMatch(q) : t.explore.empty} />} />
        </>
      )}
    </div>
  )
}

/** Stories found for the reader's interests outside their own sources. */
function ForYou() {
  const { data } = useSuggestions()
  const t = useMessages()
  const lang = useLang()
  if (!data) return null

  const again = async () => {
    queryClient.setQueryData(['suggestions'], { ...data, running: true })
    await api('/api/suggestions/round', { body: { lang } }).catch((error) => toast(errorText(error)))
    invalidate('suggestions')
  }

  return (
    <section className={p.forYou}>
      <header className={p.forYouHead}>
        <h2>{t.suggest.title}</h2>
        <button className={ui.iconButton} onClick={() => void again()} disabled={data.running} aria-label={t.suggest.refresh}>
          <RefreshCw size={20} className={cx(data.running && p.spin)} />
        </button>
      </header>
      {data.problem && !data.running && <p className={ui.error}>{messages().errors[data.problem] ?? messages().errors.fallback}</p>}
      {data.items.length > 0 ? (
        <div className={p.suggestions}>
          {data.items.map((item) => (
            <SuggestionCard key={item.article.id} item={item} />
          ))}
        </div>
      ) : (
        <p className={p.muted}>{data.running ? t.suggest.finding : t.suggest.empty}</p>
      )}
    </section>
  )
}

function WebResults({ provider, name, query }: { provider: string; name: string; query: string }) {
  const results = useWebSearch(provider, query)
  const t = useMessages()

  if (results.isPending) {
    return (
      <div className={p.results} aria-busy>
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} className={cx(p.resultPlaceholder, ui.skeleton)} />
        ))}
      </div>
    )
  }
  if (results.isError) return <Empty title={t.explore.webFailed(name)}>{errorText(results.error)}</Empty>
  if (results.data.items.length === 0) return <Empty title={t.explore.webEmpty(name, query)} />

  return (
    <>
      <FollowSearch provider={provider} query={query} />
      <div className={p.results}>
        {results.data.items.map((article) => (
          <ArticleRow key={article.id} article={article} />
        ))}
      </div>
    </>
  )
}

/** Following a search turns it into a source: its new results arrive in the feed with every refresh. */
function FollowSearch({ provider, query }: { provider: string; query: string }) {
  const { data: topics } = useTopics()
  const { data: sources } = useSources()
  const [topicId, setTopicId] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const t = useMessages()
  const chosen = topicId || topics?.[0]?.id
  const following = sources?.some((source) => source.feedUrl === `search:${provider}:${query}`)

  const follow = async () => {
    setBusy(true)
    try {
      const added = await api<Source>('/api/sources', { body: { search: { provider, query }, topicId: chosen } })
      toast(t.explore.followingSearch(added.title))
      invalidate('sources', 'topics', 'feed', 'stories', 'trending')
    } catch (error) {
      toast(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  if (!topics?.length) return null
  return (
    <div className={p.followBar}>
      {!following && (
        <select className={cx(ui.input, p.select)} value={chosen ?? ''} onChange={(event) => setTopicId(Number(event.target.value))} aria-label={t.explore.topic}>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name}
            </option>
          ))}
        </select>
      )}
      <button className={cx(ui.button, !following && ui.primary)} onClick={() => void follow()} disabled={busy || following}>
        {following ? t.common.following : t.explore.followSearch}
      </button>
    </div>
  )
}
