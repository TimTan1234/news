import { RefreshCw } from 'lucide-react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.ts'
import { invalidate, useRefresh, useSources, useTopics } from '../api/hooks.ts'
import { Feed } from '../components/Feed.tsx'
import { Wordmark } from '../components/Shell.tsx'
import { StoriesRail } from '../components/Stories.tsx'
import { Avatar, Empty, TopBar, cx, ui } from '../components/ui.tsx'
import { toast } from '../state/toast.ts'
import p from './pages.module.css'

export function Home() {
  const [search, setSearch] = useSearchParams()
  const topic = search.get('topic') ?? undefined
  const { data: topics } = useTopics()
  const refresh = useRefresh()

  const choose = (slug?: string) => {
    const next = new URLSearchParams(search)
    if (slug) next.set('topic', slug)
    else next.delete('topic')
    setSearch(next, { replace: true })
    scrollTo({ top: 0 })
  }

  const onRefresh = () =>
    refresh.mutate(undefined, {
      onSuccess: ({ added }) => toast(added ? `${added} new ${added === 1 ? 'story' : 'stories'}` : 'No new stories yet'),
      onError: (error) => toast(error.message),
    })

  return (
    <div className={p.page}>
      <TopBar title={<Wordmark className={p.mobileOnly} />}>
        <button className={ui.iconButton} onClick={onRefresh} disabled={refresh.isPending} aria-label="Refresh">
          <RefreshCw size={21} className={cx(refresh.isPending && p.spin)} />
        </button>
      </TopBar>
      <StoriesRail />
      <div className={p.chips} role="tablist" aria-label="Topics">
        <button className={cx(ui.chip, !topic && ui.chipActive)} role="tab" aria-selected={!topic} onClick={() => choose()}>
          For you
        </button>
        {topics?.map((item) => (
          <button
            key={item.id}
            className={cx(ui.chip, topic === item.slug && ui.chipActive)}
            role="tab"
            aria-selected={topic === item.slug}
            onClick={() => choose(item.slug)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <Feed
        params={{ topic }}
        caughtUp
        empty={<Empty title="No stories yet">Refresh to pull in the latest, or follow more sources in settings.</Empty>}
      />
    </div>
  )
}

export function SourcePage() {
  const id = Number(useParams().id)
  const { data: sources } = useSources()
  const source = sources?.find((item) => item.id === id)

  const toggle = async () => {
    if (!source) return
    await api(`/api/sources/${id}`, { method: 'PATCH', body: { followed: !source.followed } })
    invalidate('sources', 'feed', 'stories')
  }

  return (
    <div className={p.page}>
      <TopBar title={source?.title ?? ''} back />
      {source && (
        <div className={p.profileHead}>
          <Avatar title={source.title} icon={source.icon} size={72} />
          <div className={p.profileText}>
            <h2>{source.title}</h2>
            <a className={p.site} href={source.siteUrl} target="_blank" rel="noopener noreferrer">
              {new URL(source.siteUrl).hostname.replace(/^www\./, '')}
            </a>
          </div>
          <button className={cx(ui.button, !source.followed && ui.primary)} onClick={() => void toggle()}>
            {source.followed ? 'Following' : 'Follow'}
          </button>
        </div>
      )}
      <Feed params={{ source: id }} empty={<Empty title="Nothing from this source yet" />} />
    </div>
  )
}
