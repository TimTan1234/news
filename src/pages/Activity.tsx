import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { api, errorText, type ActivityHit } from '../api/client.ts'
import { invalidate, useActivity, useTrackers } from '../api/hooks.ts'
import { queryClient } from '../api/query.ts'
import { ArticleRow } from '../components/Row.tsx'
import { Empty, TopBar, cx, ui } from '../components/ui.tsx'
import { useMessages } from '../i18n/index.ts'
import { toast } from '../state/toast.ts'
import p from './pages.module.css'

const PER_KEYWORD = 6

export function TrackerForm() {
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const t = useMessages()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!phrase.trim()) return
    setBusy(true)
    try {
      const { hits } = await api<{ hits: number }>('/api/trackers', { body: { phrase } })
      toast(hits ? t.activity.trackingWithMatches(phrase.trim(), hits) : t.activity.tracking(phrase.trim()))
      setPhrase('')
      invalidate('trackers', 'activity')
    } catch (error) {
      toast(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={p.inlineForm} onSubmit={submit}>
      <input
        className={ui.input}
        value={phrase}
        onChange={(event) => setPhrase(event.target.value)}
        placeholder={t.activity.placeholder}
        aria-label={t.activity.keyword}
      />
      <button className={cx(ui.button, ui.primary)} disabled={busy || !phrase.trim()}>
        {t.activity.track}
      </button>
    </form>
  )
}

export function TrackerChips() {
  const { data: trackers } = useTrackers()
  const t = useMessages()
  const remove = async (id: number) => {
    await api(`/api/trackers/${id}`, { method: 'DELETE' })
    invalidate('trackers', 'activity')
  }
  if (!trackers?.length) return null
  return (
    <ul className={p.chipWrap}>
      {trackers.map((tracker) => (
        <li key={tracker.id} className={ui.chip}>
          {tracker.phrase}
          <button onClick={() => void remove(tracker.id)} aria-label={t.activity.stop(tracker.phrase)}>
            <X size={15} />
          </button>
        </li>
      ))}
    </ul>
  )
}

export function Activity() {
  const { data: hits, isPending } = useActivity()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const t = useMessages()

  // Opening the screen is what marks matches as seen; the dots stay for this visit.
  useEffect(() => {
    if (!hits?.some((hit) => !hit.seen)) return
    const timer = setTimeout(() => {
      void api('/api/activity/seen', { method: 'POST' }).then(() => {
        invalidate('trackers')
        void queryClient.invalidateQueries({ queryKey: ['activity', 'count'] })
      })
    }, 1200)
    return () => clearTimeout(timer)
  }, [hits])

  const groups = new Map<number, { phrase: string; hits: ActivityHit[] }>()
  for (const hit of hits ?? []) {
    const group = groups.get(hit.tracker.id) ?? { phrase: hit.tracker.phrase, hits: [] }
    group.hits.push(hit)
    groups.set(hit.tracker.id, group)
  }
  const ordered = [...groups.entries()].sort(
    ([, a], [, b]) => Number(b.hits.some((hit) => !hit.seen)) - Number(a.hits.some((hit) => !hit.seen)),
  )

  return (
    <div className={p.page}>
      <TopBar title={t.activity.title} />
      <div className={p.block}>
        <TrackerForm />
        <TrackerChips />
      </div>
      {isPending ? null : ordered.length === 0 ? (
        <Empty title={t.activity.emptyTitle}>{t.activity.emptyBody}</Empty>
      ) : (
        ordered.map(([id, group]) => {
          const shown = expanded.has(id) ? group.hits : group.hits.slice(0, PER_KEYWORD)
          const fresh = group.hits.filter((hit) => !hit.seen).length
          return (
            <section key={id} className={p.block}>
              <h2 className={p.groupTitle}>
                {group.phrase}
                {fresh > 0 && <span className={p.badge}>{t.activity.fresh(fresh)}</span>}
              </h2>
              {shown.map((hit) => (
                <ArticleRow key={hit.article.id} article={hit.article} fresh={!hit.seen} />
              ))}
              {group.hits.length > shown.length && (
                <button className={p.textButton} onClick={() => setExpanded(new Set(expanded).add(id))}>
                  {t.activity.showMore(group.hits.length - shown.length)}
                </button>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
