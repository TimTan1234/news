import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Ban, Download, LogOut, Moon, RotateCcw, Sun, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, errorText, type Account, type AccountLogin, type ActivityKind, type LoginCode, type Source, type Topic } from '../api/client.ts'
import { invalidate, useAccounts, useConnection, useInterests, usePairingKey, useProviders, useSources, useTopics } from '../api/hooks.ts'
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

/** The subjects suggestions are drawn from, each of which can be stopped or brought back. */
function Interests() {
  const { data: interests } = useInterests()
  const t = useMessages()

  const set = async (id: number, avoided: boolean) => {
    try {
      await api(`/api/interests/${id}`, { method: 'PATCH', body: { avoided } })
      invalidate('interests', 'suggestions')
    } catch (error) {
      toast(errorText(error))
    }
  }

  return (
    <section className={p.block}>
      <h2 className={p.groupTitle}>{t.interests.title}</h2>
      <p className={p.muted}>{interests?.length === 0 ? t.interests.empty : t.interests.hint}</p>
      {!!interests?.length && (
        <ul>
          {interests.map((interest) => {
            const stopped = interest.state === 'avoided'
            return (
              <li key={interest.id} className={p.settingRow}>
                <span className={cx(p.settingName, stopped && p.interestOff)}>{interest.label}</span>
                <span className={p.muted}>{t.interests.states[interest.state]}</span>
                <button
                  className={ui.iconButton}
                  onClick={() => void set(interest.id, !stopped)}
                  aria-label={stopped ? t.interests.restore(interest.label) : t.interests.stop(interest.label)}
                >
                  {stopped ? <RotateCcw size={18} /> : <Ban size={18} />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const KINDS: ActivityKind[] = ['watched', 'liked', 'saved', 'followed']

/** One of the reader's own accounts elsewhere: its state, what was read from it, and the sign-in that connects it. */
function AccountRow({ account }: { account: Account }) {
  const [login, setLogin] = useState<AccountLogin | null>(null)
  const [busy, setBusy] = useState(false)
  const lang = useLang()
  const t = useMessages()
  const { platform, name } = account

  // While a sign-in is open, ask whether it has landed: one question at a time, until it has or its time is up.
  useEffect(() => {
    if (!login) return
    let over = false
    let timer: ReturnType<typeof setTimeout>
    const until = Date.now() + login.lasts
    const close = (message: string) => {
      setLogin(null)
      toast(message)
    }
    const ask = async () => {
      if (Date.now() > until) return close(t.connections.expired)
      try {
        const { state } = await api<{ state: string }>(`/api/accounts/${platform}/login/check`, { body: { lang } })
        if (over) return
        if (state === 'waiting') timer = setTimeout(() => void ask(), login.every)
        else if (state === 'connected') {
          close(t.connections.learning(name))
          invalidate('accounts', 'suggestions', 'interests')
        } else close(t.connections.expired)
      } catch (error) {
        if (!over) close(errorText(error))
      }
    }
    timer = setTimeout(() => void ask(), login.every)
    return () => {
      over = true
      clearTimeout(timer)
    }
  }, [login, platform, name, lang, t])

  const connect = async () => {
    setBusy(true)
    try {
      setLogin(await api<AccountLogin>(`/api/accounts/${platform}/login`, { method: 'POST' }))
    } catch (error) {
      toast(errorText(error))
    } finally {
      setBusy(false)
    }
  }
  const disconnect = async () => {
    if (!confirm(t.connections.disconnectAccount(name))) return
    try {
      await api(`/api/accounts/${platform}`, { method: 'DELETE' })
      invalidate('accounts')
    } catch (error) {
      toast(errorText(error))
    }
  }

  const read = KINDS.flatMap((kind) => (account.activity[kind] ? t.connections.kinds[kind](account.activity[kind]) : []))

  return (
    <div className={p.field}>
      <div className={p.settingRow}>
        <span className={p.accountName}>{name}</span>
        <span className={p.accountState}>{account.connected ? account.account : t.connections.off}</span>
        {account.connected || account.via === 'extension' ? (
          <button className={ui.button} onClick={() => void disconnect()}>
            {t.connections.disconnect}
          </button>
        ) : (
          <button className={cx(ui.button, ui.primary)} disabled={busy} onClick={() => void connect()}>
            {t.connections.connect}
          </button>
        )}
      </div>
      <small>{read.length ? t.connections.read(read) : t.connections.uses[platform]}</small>
      {account.problem && <p className={ui.error}>{t.errors[account.problem] ?? t.errors.fallback}</p>}
      {login?.image && (
        <figure className={p.scan}>
          <img src={login.image} alt={t.connections.code} width={200} height={200} />
          <figcaption className={p.muted}>{t.connections.scanWith(name)}</figcaption>
        </figure>
      )}
      {login?.code && (
        <div className={p.scan}>
          <span className={p.muted}>{t.connections.enterCode}</span>
          <a href={login.url} target="_blank" rel="noreferrer">
            {login.url?.replace(/^https?:\/\//, '')}
          </a>
          <strong className={p.signInCode}>{login.code}</strong>
        </div>
      )}
    </div>
  )
}

/** The Xiaohongshu login every account's searches run through: its state, a QR code to sign in with, and signing out. */
function Xiaohongshu() {
  const [code, setCode] = useState<LoginCode | null>(null)
  const [busy, setBusy] = useState(false)
  const { data: connection } = useConnection(code !== null)
  const t = useMessages()
  const connected = connection?.connected ?? false
  const name = t.connections.xiaohongshu

  // The code is put away when the scan lands, or when the service stops waiting for it.
  useEffect(() => {
    if (!code) return
    if (connected) {
      setCode(null)
      toast(t.connections.done)
      invalidate('providers')
      return
    }
    const timer = setTimeout(() => {
      setCode(null)
      toast(t.connections.expired)
    }, code.lasts)
    return () => clearTimeout(timer)
  }, [code, connected, t])

  if (!connection?.configured) return null

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
      invalidate('connection', 'providers')
    } catch (error) {
      toast(errorText(error))
    } finally {
      setBusy(false)
    }
  }
  const connect = () =>
    run(async () => {
      const started = await api<{ code: LoginCode | null }>('/api/connections/xiaohongshu/login', { method: 'POST' })
      setCode(started.code)
      if (!started.code) toast(t.connections.done)
    })
  const disconnect = () => {
    if (!confirm(t.connections.disconnectConfirm)) return
    void run(async () => {
      await api('/api/connections/xiaohongshu', { method: 'DELETE' })
      setCode(null)
    })
  }

  return (
    <div className={p.field}>
      <div className={p.settingRow}>
        <span className={p.accountName}>{t.connections.xiaohongshuSearch}</span>
        {!connection.challenged && <span className={p.accountState}>{connected ? t.connections.connected(connection.account) : t.connections.off}</span>}
        {!connected && (
          <button className={cx(ui.button, ui.primary)} disabled={busy} onClick={() => void connect()}>
            {t.connections.connect}
          </button>
        )}
        {(connected || connection.challenged) && (
          <button className={ui.button} disabled={busy} onClick={disconnect}>
            {t.connections.disconnect}
          </button>
        )}
      </div>
      <small>{t.connections.hint}</small>
      {connection.challenged && <p className={ui.error}>{t.connections.challenged}</p>}
      {code && (
        <figure className={p.scan}>
          <img src={code.image} alt={t.connections.code} width={200} height={200} />
          <figcaption className={p.muted}>{t.connections.scanWith(name)}</figcaption>
        </figure>
      )}
    </div>
  )
}

/** The key the reader pastes into their browser extension, which then sends what it reads from their accounts. */
function Extension() {
  const { data } = usePairingKey()
  const field = useRef<HTMLInputElement>(null)
  const t = useMessages()
  const key = data?.key

  const create = async () => {
    if (key && !confirm(t.connections.newKeyConfirm)) return
    try {
      await api('/api/extension/key', { method: 'POST' })
      invalidate('pairing-key')
    } catch (error) {
      toast(errorText(error))
    }
  }
  // The clipboard is only offered on a secure address; elsewhere the browser's own copy of the selection still works.
  const copy = async () => {
    if (!key) return
    field.current?.select()
    if (navigator.clipboard) await navigator.clipboard.writeText(key).catch(() => {})
    else document.execCommand('copy')
    toast(t.connections.copied)
  }

  return (
    <div className={p.field}>
      <div className={p.settingRow}>
        <span className={p.accountName}>{t.connections.extension}</span>
        <button className={cx(ui.button, !key && ui.primary)} onClick={() => void create()}>
          {key ? t.connections.newKey : t.connections.createKey}
        </button>
      </div>
      <small>{t.connections.extensionHint}</small>
      {key && (
        <div className={p.inlineForm}>
          <input ref={field} className={ui.input} value={key} readOnly aria-label={t.connections.pairingKey} onFocus={(event) => event.target.select()} />
          <button className={ui.button} onClick={() => void copy()}>
            {t.connections.copy}
          </button>
        </div>
      )}
    </div>
  )
}

function Connections() {
  const { data: accounts } = useAccounts()
  const session = useStore(sessionStore)
  const t = useMessages()
  return (
    <section className={p.block}>
      <h2 className={p.groupTitle}>{t.connections.title}</h2>
      {accounts?.map((account) => <AccountRow key={account.platform} account={account} />)}
      <Extension />
      {session.user?.admin && <Xiaohongshu />}
    </section>
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

      <Interests />

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

      <Connections />

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
