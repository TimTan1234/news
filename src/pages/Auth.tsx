import { useState, type FormEvent } from 'react'
import { errorText } from '../api/client.ts'
import { Wordmark } from '../components/Shell.tsx'
import { cx, ui } from '../components/ui.tsx'
import { setLang, useLang, useMessages } from '../i18n/index.ts'
import { signIn } from '../state/session.ts'
import p from './pages.module.css'

export function Auth() {
  const t = useMessages()
  const lang = useLang()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(mode, username, password)
    } catch (failure) {
      setError(failure)
      setBusy(false)
    }
  }

  const swap = () => {
    setMode(mode === 'login' ? 'register' : 'login')
    setError(null)
  }

  return (
    <main className={p.auth}>
      <div className={p.authIntro}>
        <Wordmark className={p.authMark} />
        <p>{t.auth.tagline}</p>
      </div>
      <form className={p.authForm} onSubmit={submit}>
        <label className={p.field}>
          <span>{t.auth.username}</span>
          <input
            className={ui.input}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <label className={p.field}>
          <span>{t.auth.password}</span>
          <input
            className={ui.input}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'register' && <small>{t.auth.passwordHint}</small>}
        </label>
        {error !== null && (
          <p className={ui.error} role="alert">
            {errorText(error)}
          </p>
        )}
        <button className={cx(ui.button, ui.primary)} disabled={busy || !username.trim() || !password}>
          {mode === 'login' ? t.auth.signIn : t.auth.create}
        </button>
      </form>
      <button className={p.textButton} onClick={swap}>
        {mode === 'login' ? t.auth.toCreate : t.auth.toSignIn}
      </button>
      <button className={p.authLang} onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>
        {lang === 'zh' ? 'English' : '简体中文'}
      </button>
    </main>
  )
}
