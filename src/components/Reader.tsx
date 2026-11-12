import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, ExternalLink, Heart, Send, Sparkles, X } from 'lucide-react'
import type { Article, StoredSummary } from '../api/client.ts'
import { useArticle, useReader, useSummary } from '../api/hooks.ts'
import { useLang, useMessages } from '../i18n/index.ts'
import { dropLeadImage, useKey, useScrollLock } from '../lib/dom.ts'
import { longDate } from '../lib/format.ts'
import { useOverlay } from '../lib/overlay.ts'
import { markRead, setLiked, setSaved, useFlags } from '../state/flags.ts'
import { Bullets, shareArticle, SummaryBlock } from './Post.tsx'
import { Avatar, Empty, cx, ui } from './ui.tsx'
import s from './reader.module.css'

export function Reader({ id }: { id: number }) {
  const overlay = useOverlay()
  const { data, isError } = useArticle(id)
  const sheet = useRef<HTMLDivElement>(null)
  const t = useMessages()
  useScrollLock()
  useKey((event) => {
    if (event.key === 'Escape') overlay.close('read')
  })
  useEffect(() => sheet.current?.focus(), [])

  return (
    <div className={s.backdrop} onClick={(event) => event.target === event.currentTarget && overlay.close('read')}>
      <div className={s.sheet} ref={sheet} role="dialog" aria-modal aria-label={data?.article.title ?? t.reader.article} tabIndex={-1}>
        {data ? (
          <Body article={data.article} stored={data.summary} onClose={() => overlay.close('read')} />
        ) : (
          <>
            <div className={s.bar}>
              <button className={ui.iconButton} onClick={() => overlay.close('read')} aria-label={t.common.close}>
                <X size={24} />
              </button>
            </div>
            {isError ? <Empty title={t.reader.gone} /> : <div className={cx(s.hero, ui.skeleton)} />}
          </>
        )}
      </div>
    </div>
  )
}

function Body({ article: base, stored, onClose }: { article: Article; stored: StoredSummary | null; onClose: () => void }) {
  const article = useFlags(base)
  const t = useMessages()
  const lang = useLang()
  const kept = stored?.lang === lang ? stored.bullets : null
  const reader = useReader(article.id)
  const summary = useSummary(article.id)
  const [heroFailed, setHeroFailed] = useState(false)
  const hero = article.image && !heroFailed ? article.image : null
  const html = useMemo(
    () => (reader.data?.html ? (hero ? dropLeadImage(reader.data.html) : reader.data.html) : null),
    [reader.data, hero],
  )

  useEffect(() => markRead(base), [base])

  return (
    <>
      <div className={s.bar}>
        <button className={ui.iconButton} onClick={onClose} aria-label={t.common.close}>
          <X size={24} />
        </button>
        <span className={s.barSpace} />
        <button
          className={cx(ui.iconButton, article.liked && s.liked)}
          onClick={() => setLiked(article, !article.liked)}
          aria-label={t.common.like}
          aria-pressed={article.liked}
        >
          <Heart size={22} />
        </button>
        <button
          className={cx(ui.iconButton, article.saved && s.saved)}
          onClick={() => setSaved(article, !article.saved)}
          aria-label={t.common.save}
          aria-pressed={article.saved}
        >
          <Bookmark size={22} />
        </button>
        <button className={ui.iconButton} onClick={() => void shareArticle(article)} aria-label={t.common.share}>
          <Send size={21} />
        </button>
        <a className={ui.iconButton} href={article.url} target="_blank" rel="noopener noreferrer" aria-label={t.common.openOriginal}>
          <ExternalLink size={21} />
        </a>
      </div>

      <article className={s.article}>
        {hero && <img className={s.hero} src={hero} alt="" referrerPolicy="no-referrer" onError={() => setHeroFailed(true)} />}
        <div className={s.column}>
          <div className={s.meta}>
            <Avatar title={article.source.title} icon={article.source.icon} size={36} />
            <div className={s.metaText}>
              <span className={s.sourceName}>{article.source.title}</span>
              <span className={s.date}>{longDate(article.publishedAt)}</span>
            </div>
          </div>
          <h1 className={s.title}>{article.title}</h1>
          {article.author && <p className={s.author}>{article.author}</p>}

          {kept && !summary.data ? (
            <Bullets items={kept} />
          ) : summary.isIdle ? (
            <button className={cx(ui.button, s.summarize)} onClick={() => summary.mutate()}>
              <Sparkles size={18} /> {t.common.summarize}
            </button>
          ) : (
            <SummaryBlock summary={summary} />
          )}

          {reader.isPending ? (
            <div className={s.loading} aria-busy>
              {[100, 96, 88, 100, 92, 60].map((width, index) => (
                <span key={index} className={cx(s.loadingLine, ui.skeleton)} style={{ width: `${width}%` }} />
              ))}
            </div>
          ) : html ? (
            <div className={s.prose} dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <div className={s.fallback}>
              {article.excerpt && <p className={s.prose}>{article.excerpt}</p>}
              <a className={cx(ui.button, ui.primary)} href={article.url} target="_blank" rel="noopener noreferrer">
                {t.reader.continueOn(article.source.title)} <ExternalLink size={16} />
              </a>
            </div>
          )}
        </div>
      </article>
    </>
  )
}
