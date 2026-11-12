import { useRef, useState, type FormEvent } from 'react'
import { Download, Moon, Sun, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, type Source, type Topic } from '../api/client.ts'
import { invalidate, useSources, useTopics } from '../api/hooks.ts'
import { Avatar, TopBar, cx, ui } from '../components/ui.tsx'
import { useStore } from '../state/store.ts'
import { setTheme, themeStore } from '../state/theme.ts'
import { toast } from '../state/toast.ts'
import { TrackerChips, TrackerForm } from './Activity.tsx'
import p from './pages.module.css'

const refreshLibrary = () => invalidate('sources', 'topics', 'feed', 'stories', 'trending')

async function attempt(action: () => Promise<unknown>, done?: string): Promise<boolean> {
  try {
    await action()
    if (done) toast(done)
    refreshLibrary()
    return true
  } catch (error) {
    toast((error as Error).message)
    return false
  }
}

function SourceRow({ source }: { source: Source }) {
  const toggle = () => attempt(() => api(`/api/sources/${source.id}`, { method: 'PATCH', body: { followed: !source.followed } }))
  const remove = () => {
    if (!confirm(`Remove ${source.title}? Its stories, including saved ones, go with it.`)) return
    void attempt(() => api(`/api/sources/${source.id}`, { method: 'DELETE' }), `Removed ${source.title}`)
  }
  return (
    <li className={p.sourceRow}>
      <Link to={`/source/${source.id}`} className={p.sourceName}>
        <Avatar title={source.title} icon={source.icon} size={32} />
        <span>{source.title}</span>
      </Link>
      {source.error && (
        <span className={p.sourceError} title={`Last refresh failed: ${source.error}`} aria-label={`Last refresh failed: ${source.error}`}>
          <TriangleAlert size={18} />
        </span>
      )}
      <button
        className={cx(p.switch, source.followed && p.switchOn)}
        role="switch"
        aria-checked={source.followed}
        aria-label={`Follow ${source.title}`}
        onClick={() => void toggle()}
      />
      <button className={ui.iconButton} onClick={remove} aria-label={`Remove ${source.title}`}>
        <Trash2 size={18} />
      </button>
    </li>
  )
}

function AddSource({ topics }: { topics: Topic[] }) {
  const [url, setUrl] = useState('')
  const [topicId, setTopicId] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const chosen = topicId || topics[0]?.id

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    let added: Source | undefined
    const ok = await attempt(async () => {
      added = await api<Source>('/api/sources', { body: { url, topicId: chosen } })
    })
    if (ok && added) {
      toast(`Following ${added.title}`)
      setUrl('')
    }
    setBusy(false)
  }

  return (
    <form className={p.inlineForm} onSubmit={submit}>
      <input
        className={ui.input}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="Site or feed address"
        aria-label="Site or feed address"
        inputMode="url"
      />
      <select className={cx(ui.input, p.select)} value={chosen ?? ''} onChange={(event) => setTopicId(Number(event.target.value))} aria-label="Topic">
        {topics.map((topic) => (
          <option key={topic.id} value={topic.id}>
            {topic.name}
          </option>
        ))}
      </select>
      <button className={cx(ui.button, ui.primary)} disabled={busy || !url.trim() || !chosen}>
        {busy ? 'Finding feed…' : 'Add source'}
      </button>
    </form>
  )
}

function AddTopic() {
  const [name, setName] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await attempt(() => api('/api/topics', { body: { name } }), `Added ${name.trim()}`)) setName('')
  }
  return (
    <form className={p.inlineForm} onSubmit={submit}>
      <input className={ui.input} value={name} onChange={(event) => setName(event.target.value)} placeholder="New topic, like Science" aria-label="New topic name" />
      <button className={ui.button} disabled={!name.trim()}>
        Add topic
      </button>
    </form>
  )
}

function Backup() {
  const file = useRef<HTMLInputElement>(null)
  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen) return
    const xml = await chosen.text()
    let added = 0
    const ok = await attempt(async () => {
      added = (await api<{ added: number }>('/api/opml', { body: { xml } })).added
    })
    if (ok) toast(added ? `Imported ${added} ${added === 1 ? 'source' : 'sources'}` : 'Those sources were already in your list')
  }
  return (
    <div className={p.buttonRow}>
      <a className={ui.button} href="/api/opml" download>
        <Download size={18} /> Export sources
      </a>
      <button className={ui.button} onClick={() => file.current?.click()}>
        <Upload size={18} /> Import OPML
      </button>
      <input ref={file} type="file" accept=".opml,.xml,text/xml" hidden onChange={(event) => void onFile(event)} />
    </div>
  )
}

export function Settings() {
  const theme = useStore(themeStore)
  const { data: topics } = useTopics()
  const { data: sources } = useSources()

  const removeTopic = (topic: Topic) => {
    if (!confirm(`Remove ${topic.name} and its ${topic.sources} sources?`)) return
    void attempt(() => api(`/api/topics/${topic.id}`, { method: 'DELETE' }), `Removed ${topic.name}`)
  }

  return (
    <div className={p.page}>
      <TopBar title="Settings" back />

      <section className={p.block}>
        <h2 className={p.groupTitle}>Appearance</h2>
        <div className={p.segmented} role="radiogroup" aria-label="Theme">
          {([['dark', 'Dark', Moon], ['light', 'Light', Sun]] as const).map(([value, label, Icon]) => (
            <button key={value} role="radio" aria-checked={theme === value} className={cx(p.segment, theme === value && p.segmentOn)} onClick={() => setTheme(value)}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </div>
      </section>

      <section className={p.block}>
        <h2 className={p.groupTitle}>Keywords</h2>
        <TrackerForm />
        <TrackerChips />
      </section>

      <section className={p.block}>
        <h2 className={p.groupTitle}>Sources</h2>
        {topics && <AddSource topics={topics} />}
        {topics?.map((topic) => (
          <div key={topic.id} className={p.topicGroup}>
            <div className={p.topicHead}>
              <h3>{topic.name}</h3>
              <button className={ui.iconButton} onClick={() => removeTopic(topic)} aria-label={`Remove topic ${topic.name}`}>
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
        <h2 className={p.groupTitle}>Backup</h2>
        <Backup />
      </section>
    </div>
  )
}
