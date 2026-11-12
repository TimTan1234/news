import { useRef, useState, type FormEvent } from 'react'
import { Download, LogOut, Moon, Sun, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, errorText, type Source, type Topic } from '../api/client.ts'
import { invalidate, useProviders, useSources, useTopics } from '../api/hooks.ts'
import { Avatar, TopBar, cx, ui } from '../components/ui.tsx'
import { setLang, useLang, useMessages, type Lang } from '../i18n/index.ts'
import { sessionStore, signOut } from '../state/session.ts'
import { useStore } from '../state/store.ts'
import { setTheme, themeStore } from '../state/theme.ts'
import { toast } from '../state/toast.ts'
import { TrackerChips, TrackerForm } from './Activity.tsx'
import p from './pages.module.css'

const LANGUAGES: [Lang, string][] = [
  ['en', 'English'],
  ['zh', '简体中文'],
]

const FEED = 'feed'

const refreshLibrary = () => invalidate('sources', 'topics', 'feed', 'stories', 'trending')

async function attempt(action: () => Promise<unknown>, done?: string): Promise<boolean> {
  try {
    await action()
    if (done) toast(done)
    refreshLibrary()
    return true
  } catch (error) {
    toast(errorText(error))
    return false
  }
}

function SourceRow({ source }: { source: Source }) {
  const t = useMessages()
  const toggle = () => attempt(() => api(`/api/sources/${source.id}`, { method: 'PATCH', body: { followed: !source.followed } }))
  const remove = () => {
    if (!confirm(t.settings.removeSourceConfirm(source.title))) return
    void attempt(() => api(`/api/sources/${source.id}`, { method: 'DELETE' }), t.settings.removed(source.title))
  }
  return (
    <li className={p.sourceRow}>
      <Link to={`/source/${source.id}`} className={p.sourceName}>
        <Avatar title={source.title} icon={source.icon} size={32} />
        <span>{source.title}</span>
      </Link>
      {source.error && (
        <span className={p.sourceError} title={t.settings.refreshFailed(source.error)} aria-label={t.settings.refreshFailed(source.error)}>
          <TriangleAlert size={18} />
        </span>
      )}
      <button
        className={cx(p.switch, source.followed && p.switchOn)}
        role="switch"
        aria-checked={source.followed}
        aria-label={t.settings.followSource(source.title)}
        onClick={() => void toggle()}
      />
      <button className={ui.iconButton} onClick={remove} aria-label={t.settings.removeSource(source.title)}>
        <Trash2 size={18} />
      </button>
    </li>
  )
}

function AddSource({ topics }: { topics: Topic[] }) {
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState(FEED)
  const [topicId, setTopicId] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const { data: providers } = useProviders()
  const t = useMessages()
  const chosen = topicId || topics[0]?.id
  const isFeed = kind === FEED

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    let added: Source | undefined
    const ok = await attempt(async () => {
      const what = isFeed ? { url } : { search: { provider: kind, query: url } }
      added = await api<Source>('/api/sources', { body: { ...what, topicId: chosen } })
    })
    if (ok && added) {
      toast(t.settings.followingSource(added.title))
      setUrl('')
    }
    setBusy(false)
  }

  return (
    <div className={p.field}>
      <form className={p.inlineForm} onSubmit={submit}>
        <select className={cx(ui.input, p.select)} value={kind} onChange={(event) => setKind(event.target.value)} aria-label={t.settings.kind}>
          <option value={FEED}>{t.settings.kindFeed}</option>
          {providers?.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {t.settings.searchOn(t.explore.providers[provider.id] ?? provider.name)}
            </option>
          ))}
        </select>
        <input
          className={ui.input}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={isFeed ? t.settings.addressPlaceholder : t.settings.keywordPlaceholder}
          aria-label={isFeed ? t.settings.addressPlaceholder : t.settings.keywordPlaceholder}
          aria-describedby="address-hint"
          inputMode={isFeed ? 'url' : 'text'}
        />
        <select className={cx(ui.input, p.select)} value={chosen ?? ''} onChange={(event) => setTopicId(Number(event.target.value))} aria-label={t.settings.topic}>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name}
            </option>
          ))}
        </select>
        <button className={cx(ui.button, ui.primary)} disabled={busy || !url.trim() || !chosen}>
          {busy && isFeed ? t.settings.finding : t.settings.addSource}
        </button>
      </form>
      <small id="address-hint">{isFeed ? t.settings.addressHint : t.settings.searchHint}</small>
    </div>
  )
}

function AddTopic() {
  const [name, setName] = useState('')
  const t = useMessages()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await attempt(() => api('/api/topics', { body: { name } }), t.settings.addedTopic(name.trim()))) setName('')
  }
  return (
    <form className={p.inlineForm} onSubmit={submit}>
      <input className={ui.input} value={name} onChange={(event) => setName(event.target.value)} placeholder={t.settings.newTopic} aria-label={t.settings.newTopicLabel} />
      <button className={ui.button} disabled={!name.trim()}>
        {t.settings.addTopic}
      </button>
    </form>
  )
}

function Backup() {
  const file = useRef<HTMLInputElement>(null)
  const t = useMessages()
  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen) return
    const xml = await chosen.text()
    let added = 0
    const ok = await attempt(async () => {
      added = (await api<{ added: number }>('/api/opml', { body: { xml } })).added
    })
    if (ok) toast(added ? t.settings.imported(added) : t.settings.importedNone)
  }
  return (
    <div className={p.buttonRow}>
      <a className={ui.button} href="/api/opml" download>
        <Download size={18} /> {t.settings.exportSources}
      </a>
      <button className={ui.button} onClick={() => file.current?.click()}>
        <Upload size={18} /> {t.settings.importOpml}
      </button>
      <input ref={file} type="file" accept=".opml,.xml,text/xml" hidden onChange={(event) => void onFile(event)} />
    </div>
  )
}

export function Settings() {
  const theme = useStore(themeStore)
  const session = useStore(sessionStore)
  const lang = useLang()
  const t = useMessages()
  const { data: topics } = useTopics()
  const { data: sources } = useSources()

  const removeTopic = (topic: Topic) => {
    if (!confirm(t.settings.removeTopicConfirm(topic.name, topic.sources))) return
    void attempt(() => api(`/api/topics/${topic.id}`, { method: 'DELETE' }), t.settings.removed(topic.name))
  }

  return (
    <div className={p.page}>
      <TopBar title={t.settings.title} back />

      <section className={p.block}>
        <h2 className={p.groupTitle}>{t.settings.appearance}</h2>
        <div className={p.segmented} role="radiogroup" aria-label={t.settings.theme}>
          {([['dark', t.settings.dark, Moon], ['light', t.settings.light, Sun]] as const).map(([value, label, Icon]) => (
            <button key={value} role="radio" aria-checked={theme === value} className={cx(p.segment, theme === value && p.segmentOn)} onClick={() => setTheme(value)}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </div>
        <div className={p.segmented} role="radiogroup" aria-label={t.settings.language}>
          {LANGUAGES.map(([value, label]) => (
            <button key={value} role="radio" aria-checked={lang === value} className={cx(p.segment, lang === value && p.segmentOn)} onClick={() => setLang(value)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className={p.block}>
        <h2 className={p.groupTitle}>{t.settings.keywords}</h2>
        <TrackerForm />
        <TrackerChips />
      </section>

      <section className={p.block}>
        <h2 className={p.groupTitle}>{t.settings.sources}</h2>
        {topics && <AddSource topics={topics} />}
        {topics?.map((topic) => (
          <div key={topic.id} className={p.topicGroup}>
            <div className={p.topicHead}>
              <h3>{topic.name}</h3>
              <button className={ui.iconButton} onClick={() => removeTopic(topic)} aria-label={t.settings.removeTopic(topic.name)}>
                <Trash2 size={18} />
              </button>
            </div>
            <ul>
              {sources?.filter((source) => source.topicId === topic.id).map((source) => <SourceRow key={source.id} source={source} />)}
            </ul>
          </div>
        ))}
        <AddTopic />
      </section>

      <section className={p.block}>
        <h2 className={p.groupTitle}>{t.settings.backup}</h2>
        <Backup />
      </section>

      {session.user && (
        <section className={p.block}>
          <h2 className={p.groupTitle}>{t.settings.account}</h2>
          <p className={p.muted}>{t.settings.signedInAs(session.user.username)}</p>
          <div className={p.buttonRow}>
            <button className={ui.button} onClick={() => void signOut()}>
              <LogOut size={18} /> {t.settings.signOut}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
