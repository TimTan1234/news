import { useState, type FormEvent } from 'react'
import { Ban, Bookmark, Ellipsis, EyeOff, Heart } from 'lucide-react'
import { api, errorText, type Source, type Suggestion } from '../api/client.ts'
import { invalidate, useFollowOptions, useTopics } from '../api/hooks.ts'
import { useLang, useMessages } from '../i18n/index.ts'
import { ago } from '../lib/format.ts'
import { useOverlay } from '../lib/overlay.ts'
import { hide, setLiked, setSaved, useFlags } from '../state/flags.ts'
import { toast } from '../state/toast.ts'
import { Media, useImage } from './Post.tsx'
import { Avatar, Menu, cx, ui } from './ui.tsx'
import s from './suggestion.module.css'

const NEW_TOPIC = 'new'

/** Turns a suggestion into something lasting: the site's feed or a search for its subject, filed under a topic. */
function FollowSheet({ articleId, onClose }: { articleId: number; onClose: () => void }) {
  const { data: options, error } = useFollowOptions(articleId)
  const { data: topics } = useTopics()
  const [what, setWhat] = useState<'site' | 'search' | null>(null)
  const [topic, setTopic] = useState<string | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const t = useMessages()

  if (error) return <p className={cx(s.sheet, ui.error)}>{errorText(error)}</p>
  if (!options || !topics) return <div className={cx(s.sheet, s.sheetLoading, ui.skeleton)} aria-busy />
  if (!options.site && !options.search) return <p className={cx(s.sheet, s.note)}>{t.suggest.nothingToFollow}</p>

  const chosen = what ?? (options.site ? 'site' : 'search')
  const topicValue = topic ?? (options.topicId ? String(options.topicId) : options.newTopic || topics.length === 0 ? NEW_TOPIC : String(topics[0].id))
  const topicName = name ?? options.newTopic ?? ''

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const filing = topicValue === NEW_TOPIC ? { newTopic: topicName } : { topicId: Number(topicValue) }
      const added = await api<Source>(`/api/suggestions/${articleId}/follow`, { body: { what: chosen, ...filing } })
      toast(t.settings.followingSource(added.title))
      invalidate('sources', 'topics', 'feed', 'stories', 'interests', 'follow-options')
      onClose()
    } catch (failure) {
      toast(errorText(failure))
      setBusy(false)
    }
  }

  return (
    <form className={s.sheet} onSubmit={submit}>
      <div role="radiogroup" className={s.choices}>
        {(['site', 'search'] as const).map(
          (kind) =>
            options[kind] && (
              <button key={kind} type="button" role="radio" aria-checked={chosen === kind} className={cx(s.choice, chosen === kind && s.choiceOn)} onClick={() => setWhat(kind)}>
                <span className={s.choiceTitle}>{options[kind].title}</span>
                <span className={s.note}>{kind === 'site' ? t.suggest.siteFeed : t.suggest.searchFeed}</span>
              </button>
            ),
        )}
      </div>
      <div className={s.filing}>
        <select className={cx(ui.input, s.topic)} value={topicValue} onChange={(event) => setTopic(event.target.value)} aria-label={t.settings.topic}>
          {topics.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
          <option value={NEW_TOPIC}>{t.suggest.newTopic}</option>
        </select>
        {topicValue === NEW_TOPIC && (
          <input className={ui.input} value={topicName} onChange={(event) => setName(event.target.value)} placeholder={t.settings.newTopicLabel} aria-label={t.settings.newTopicLabel} />
        )}
      </div>
      <div className={s.sheetActions}>
        <button type="button" className={ui.button} onClick={onClose}>
          {t.common.cancel}
        </button>
        <button className={cx(ui.button, ui.primary)} disabled={busy || (topicValue === NEW_TOPIC && !topicName.trim())}>
          {t.common.follow}
        </button>
      </div>
    </form>
  )
}

export function SuggestionCard({ item }: { item: Suggestion }) {
  const article = useFlags(item.article)
  const overlay = useOverlay()
  const image = useImage(article)
  const [following, setFollowing] = useState(false)
  const t = useMessages()
  const lang = useLang()

  if (article.hidden) return null

  const { label, kind } = item.interest
  const platform = t.explore.providers[item.provider] ?? item.provider
  const interested = article.liked || article.saved

  const avoid = async () => {
    try {
      await api(`/api/interests/${item.interest.id}`, { method: 'PATCH', body: { avoided: true } })
      toast(t.suggest.avoided(label))
      invalidate('suggestions', 'interests')
    } catch (failure) {
      toast(errorText(failure))
    }
  }

  return (
    <article className={s.card}>
      <button className={s.open} onClick={() => overlay.open('read', article.id)}>
        <span className={s.text}>
          <span className={s.byline}>
            <Avatar title={article.source.title} icon={article.source.icon} size={20} />
            <span className={s.source}>{article.source.title}</span>
            {platform !== article.source.title && <span className={s.platform}>{platform}</span>}
            <span className={s.age}>{ago(article.publishedAt)}</span>
          </span>
          <span className={cx(s.title, article.read && s.read)}>{article.title}</span>
          {item.reason && item.lang === lang && <span className={s.reason}>{item.reason}</span>}
        </span>
        {image.src && (
          <span className={s.thumb}>
            <Media article={article} image={image} compact />
          </span>
        )}
      </button>

      <div className={s.actions}>
        <span className={cx(s.subject, kind !== 'near' && s.trying)}>{kind === 'near' ? label : t.suggest.trying(label)}</span>
        <button className={cx(ui.iconButton, article.liked && s.liked)} onClick={() => setLiked(article, !article.liked)} aria-label={t.common.like} aria-pressed={article.liked}>
          <Heart size={20} />
        </button>
        <button className={cx(ui.iconButton, article.saved && s.saved)} onClick={() => setSaved(article, !article.saved)} aria-label={t.common.save} aria-pressed={article.saved}>
          <Bookmark size={20} />
        </button>
        <button className={cx(ui.button, s.follow, interested && ui.primary)} onClick={() => setFollowing(!following)} aria-expanded={following}>
          {interested ? t.suggest.followSubject(label) : t.common.follow}
        </button>
        <Menu label={t.common.more} trigger={<Ellipsis size={20} />}>
          {(close) => (
            <>
              <button className={ui.menuItem} role="menuitem" onClick={() => (close(), hide(article))}>
                <EyeOff size={18} /> {t.suggest.notInterested}
              </button>
              <button className={ui.menuItem} role="menuitem" onClick={() => (close(), void avoid())}>
                <Ban size={18} /> {t.suggest.avoid(label)}
              </button>
            </>
          )}
        </Menu>
      </div>

      {following && <FollowSheet articleId={article.id} onClose={() => setFollowing(false)} />}
    </article>
  )
}
