import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Bookmark, Ellipsis, EyeOff, Heart, Link as LinkIcon, Send, Sparkles, UserMinus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, type Article } from '../api/client.ts'
import { invalidate, useSummary } from '../api/hooks.ts'
import { ago } from '../lib/format.ts'
import { share, useOverlay } from '../lib/overlay.ts'
import { hide, markSeen, setLiked, setSaved, useFlags } from '../state/flags.ts'
import { toast } from '../state/toast.ts'
import { Avatar, Menu, cx, ui } from './ui.tsx'
import s from './post.module.css'

/** The article's image, or `null` once it is known to be missing or broken. */
export function useImage(article: Article) {
  const [failed, setFailed] = useState(false)
  return { src: article.image && !failed ? article.image : null, onError: () => setFailed(true) }
}

/** The article's image, or a poster of its headline when there is none. */
export function Media({
  article,
  className,
  compact,
  image,
}: {
  article: Article
  className?: string
  compact?: boolean
  image?: ReturnType<typeof useImage>
}) {
  const own = useImage(article)
  const { src, onError } = image ?? own
  if (src) {
    return <img className={cx(s.image, className)} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={onError} />
  }
  const angle = { '--tile-angle': `${(article.source.id * 67) % 360}deg` } as CSSProperties
  return (
    <div className={cx(s.typeTile, compact && s.typeTileCompact, className)} style={angle} aria-hidden>
      <span>{article.title}</span>
    </div>
  )
}

export async function shareArticle(article: Article): Promise<void> {
  const outcome = await share(article.title, article.url)
  if (outcome === 'copied') toast('Link copied')
  if (outcome === 'failed') toast('Could not share this link')
}

/** Marks the article seen once most of the card has been on screen. */
function useSeen(ref: RefObject<HTMLElement | null>, article: Article): void {
  useEffect(() => {
    const element = ref.current
    if (!element || article.seen) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          markSeen(article)
          observer.disconnect()
        }
      },
      { threshold: 0.6 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, article])
}

export function SummaryBlock({ summary }: { summary: ReturnType<typeof useSummary> }) {
  if (summary.isPending) {
    return (
      <div className={s.summary} aria-busy>
        {[92, 100, 74].map((width) => (
          <span key={width} className={cx(s.summaryLine, ui.skeleton)} style={{ width: `${width}%` }} />
        ))}
      </div>
    )
  }
  if (summary.isError) return <p className={cx(s.summary, ui.error)}>{summary.error.message}</p>
  return summary.data ? <Bullets items={summary.data.bullets} /> : null
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <ul className={s.summary}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

export function PostCard({ article: base }: { article: Article }) {
  const article = useFlags(base)
  const overlay = useOverlay()
  const ref = useRef<HTMLElement>(null)
  const tap = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [burst, setBurst] = useState(0)
  const summary = useSummary(article.id)
  const image = useImage(article)
  useSeen(ref, base)

  if (article.hidden) return null

  const openReader = () => overlay.open('read', article.id)

  // One tap opens the story; a second tap inside the window likes it instead.
  const onMediaClick = () => {
    if (tap.current) {
      clearTimeout(tap.current)
      tap.current = undefined
      setLiked(article, true)
      setBurst((count) => count + 1)
      return
    }
    tap.current = setTimeout(() => {
      tap.current = undefined
      openReader()
    }, 240)
  }

  const unfollow = async () => {
    await api(`/api/sources/${article.source.id}`, { method: 'PATCH', body: { followed: false } })
    invalidate('feed', 'stories', 'sources')
    toast(`Unfollowed ${article.source.title}`)
  }

  const copy = async () => {
    await navigator.clipboard.writeText(article.url)
    toast('Link copied')
  }

  return (
    <article ref={ref} className={s.post} data-post={article.id} tabIndex={-1}>
      <header className={s.head}>
        <Link to={`/source/${article.source.id}`} className={s.byline}>
          <Avatar title={article.source.title} icon={article.source.icon} size={36} />
          <span className={s.names}>
            <span className={s.sourceName}>{article.source.title}</span>
            <span className={s.topicName}>{article.topic.name}</span>
          </span>
        </Link>
        <time className={s.age} dateTime={new Date(article.publishedAt).toISOString()}>
          {ago(article.publishedAt)}
        </time>
        <Menu label="More" trigger={<Ellipsis size={20} />}>
          {(close) => (
            <>
              <button className={ui.menuItem} role="menuitem" onClick={() => (close(), hide(article))}>
                <EyeOff size={18} /> Hide this story
              </button>
              <button className={ui.menuItem} role="menuitem" onClick={() => (close(), void unfollow())}>
                <UserMinus size={18} /> Unfollow {article.source.title}
              </button>
              <button className={ui.menuItem} role="menuitem" onClick={() => (close(), void copy())}>
                <LinkIcon size={18} /> Copy link
              </button>
            </>
          )}
        </Menu>
      </header>

      <button className={s.media} onClick={onMediaClick} aria-label={`Read: ${article.title}`}>
        <Media article={article} image={image} />
        {burst > 0 && <Heart key={burst} className={s.burst} size={96} aria-hidden />}
      </button>

      <div className={s.actions}>
        <button
          className={cx(ui.iconButton, article.liked && s.liked)}
          onClick={() => setLiked(article, !article.liked)}
          aria-label="Like"
          aria-pressed={article.liked}
        >
          <Heart size={24} />
        </button>
        <button
          className={cx(ui.iconButton, summary.data && s.summarized)}
          onClick={() => !summary.isPending && !summary.data && summary.mutate()}
          aria-label="Summarize"
        >
          <Sparkles size={23} />
        </button>
        <button className={ui.iconButton} onClick={() => void shareArticle(article)} aria-label="Share">
          <Send size={22} />
        </button>
        <button
          className={cx(ui.iconButton, s.save, article.saved && s.saved)}
          onClick={() => setSaved(article, !article.saved)}
          aria-label="Save"
          aria-pressed={article.saved}
        >
          <Bookmark size={24} />
        </button>
      </div>

      <div className={s.text}>
        {image.src && (
          <h2 className={cx(s.headline, article.read && s.read)}>
            <button onClick={openReader}>{article.title}</button>
          </h2>
        )}
        {article.excerpt && <p className={s.excerpt}>{article.excerpt}</p>}
        <SummaryBlock summary={summary} />
      </div>
    </article>
  )
}

export function PostSkeleton() {
  return (
    <div className={s.post} aria-hidden>
      <div className={s.head}>
        <span className={cx(s.skeletonAvatar, ui.skeleton)} />
        <span className={cx(s.skeletonLine, ui.skeleton)} style={{ width: 120 }} />
      </div>
      <div className={cx(s.media, s.skeletonMedia, ui.skeleton)} />
      <div className={s.text}>
        <span className={cx(s.skeletonLine, ui.skeleton)} style={{ width: '90%', height: 18 }} />
        <span className={cx(s.skeletonLine, ui.skeleton)} style={{ width: '60%' }} />
      </div>
    </div>
  )
}
