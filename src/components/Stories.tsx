import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Bookmark, ChevronLeft, ChevronRight, Heart, Send, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { Article, Story } from '../api/client.ts'
import { useStories } from '../api/hooks.ts'
import { useMessages } from '../i18n/index.ts'
import { useKey, useScrollLock } from '../lib/dom.ts'
import { ago } from '../lib/format.ts'
import { useOverlay } from '../lib/overlay.ts'
import { markSeen, setLiked, setSaved, useFlagChanges, useFlags, withFlags } from '../state/flags.ts'
import { Media, shareArticle, useImage } from './Post.tsx'
import { Avatar, cx, ui } from './ui.tsx'
import s from './stories.module.css'

const unread = (story: Story) => story.items.filter((item) => !withFlags(item).seen).length

export function StoriesRail() {
  const { data, isPending } = useStories()
  const overlay = useOverlay()
  const t = useMessages()
  useFlagChanges()

  if (isPending) {
    return (
      <div className={s.rail} aria-hidden>
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index} className={cx(s.placeholder, ui.skeleton)} />
        ))}
      </div>
    )
  }
  if (!data?.length) return null

  return (
    <ul className={s.rail} aria-label={t.stories.label}>
      {data.map((story) => (
        <li key={story.source.id}>
          <button
            className={s.story}
            onClick={() => overlay.open('story', story.source.id)}
            aria-label={t.stories.unread(story.source.title, unread(story))}
          >
            <Avatar
              title={story.source.title}
              icon={story.source.icon}
              size={56}
              ring={story.items.map((item) => !withFlags(item).seen)}
            />
            <span className={cx(s.storyName, unread(story) > 0 && s.storyNew)}>{story.source.title}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

const DURATION_MS = 6000
const firstUnseen = (story: Story) => Math.max(0, story.items.findIndex((item) => !withFlags(item).seen))

export function StoryViewer({ sourceId }: { sourceId: number }) {
  const { data } = useStories()
  const overlay = useOverlay()
  const [search] = useSearchParams()
  const [stories, setStories] = useState<Story[] | null>(null)
  const [position, setPosition] = useState<{ source: number; item: number } | null>(null)
  const [held, setHeld] = useState(false)
  const press = useRef<{ x: number; y: number; at: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const t = useMessages()
  useScrollLock()

  // The order is frozen when the viewer opens, so marking items seen cannot reshuffle it mid-play.
  useEffect(() => {
    if (stories || !data) return
    const start = data.findIndex((story) => story.source.id === sourceId)
    if (start < 0) {
      overlay.close('story')
      return
    }
    setStories(data)
    setPosition({ source: start, item: firstUnseen(data[start]) })
  }, [data, stories, sourceId, overlay])

  const story = stories && position ? stories[position.source] : null
  const article = story && position ? story.items[position.item] : null

  useEffect(() => {
    if (article) markSeen(article)
  }, [article])

  useEffect(() => frame.current?.focus(), [stories])

  const readerOpen = search.has('read')
  const paused = held || readerOpen

  const next = () => {
    if (!stories || !position || !story) return
    if (position.item + 1 < story.items.length) setPosition({ ...position, item: position.item + 1 })
    else if (position.source + 1 < stories.length) {
      setPosition({ source: position.source + 1, item: firstUnseen(stories[position.source + 1]) })
    } else overlay.close('story')
  }

  const previous = () => {
    if (!stories || !position) return
    if (position.item > 0) setPosition({ ...position, item: position.item - 1 })
    else if (position.source > 0) {
      setPosition({ source: position.source - 1, item: stories[position.source - 1].items.length - 1 })
    }
  }

  useKey((event) => {
    if (event.key === 'ArrowRight') next()
    if (event.key === 'ArrowLeft') previous()
    if (event.key === 'Escape') overlay.close('story')
  }, !readerOpen)

  if (!story || !article || !position) return <div className={s.backdrop} />

  const openReader = () => overlay.open('read', article.id)

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    setHeld(false)
    const start = press.current
    press.current = null
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (dy > 80 && Math.abs(dy) > Math.abs(dx)) return overlay.close('story')
    if (dy < -80 && Math.abs(dy) > Math.abs(dx)) return openReader()
    if (Date.now() - start.at > 300 || Math.abs(dx) > 12 || Math.abs(dy) > 12) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX - bounds.left < bounds.width / 3) previous()
    else next()
  }

  return (
    <div className={s.backdrop} role="dialog" aria-modal aria-label={t.stories.from(story.source.title)}>
      <button className={cx(s.step, s.stepBack)} onClick={previous} aria-label={t.stories.previous}>
        <ChevronLeft size={28} />
      </button>

      <div className={s.frame} ref={frame} tabIndex={-1}>
        <Slide
          key={article.id}
          article={article}
          gestures={{
            onPointerDown: (event) => {
              press.current = { x: event.clientX, y: event.clientY, at: Date.now() }
              setHeld(true)
            },
            onPointerUp,
            onPointerCancel: () => {
              press.current = null
              setHeld(false)
            },
          }}
        />

        <div className={s.top}>
          <div className={s.progress}>
            {story.items.map((item, index) => (
              <span key={item.id} className={s.segment}>
                {index < position.item && <span className={s.done} />}
                {index === position.item && (
                  <span
                    key={`${position.source}-${position.item}`}
                    className={s.running}
                    style={{ animationDuration: `${DURATION_MS}ms`, animationPlayState: paused ? 'paused' : 'running' }}
                    onAnimationEnd={next}
                  />
                )}
              </span>
            ))}
          </div>
          <div className={s.header}>
            <Avatar title={story.source.title} icon={story.source.icon} size={32} />
            <span className={s.sourceName}>{story.source.title}</span>
            <span className={s.age}>{ago(article.publishedAt)}</span>
            <button className={s.control} onClick={() => overlay.close('story')} aria-label={t.stories.close}>
              <X size={24} />
            </button>
          </div>
        </div>

        <StoryActions article={article} onRead={openReader} />
      </div>

      <button className={cx(s.step, s.stepNext)} onClick={next} aria-label={t.stories.next}>
        <ChevronRight size={28} />
      </button>
    </div>
  )
}

type Gestures = Pick<React.HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onPointerUp' | 'onPointerCancel'>

/** A story with an image shows it over a blurred copy of itself; one without becomes a full-bleed poster. */
function Slide({ article, gestures }: { article: Article; gestures: Gestures }) {
  const image = useImage(article)
  const angle = { '--tile-angle': `${(article.source.id * 67) % 360}deg` } as CSSProperties
  return (
    <>
      {image.src ? (
        <img className={s.wash} src={image.src} alt="" referrerPolicy="no-referrer" />
      ) : (
        <div className={s.posterWash} style={angle} />
      )}
      <div className={cx(s.stage, !image.src && s.poster)} {...gestures}>
        {image.src && (
          <div className={s.card}>
            <Media article={article} image={image} className={s.cardMedia} />
          </div>
        )}
        <div className={s.copy}>
          {article.topic && <span className={s.topic}>{article.topic.name}</span>}
          <h2 className={s.headline}>{article.title}</h2>
          {article.excerpt && <p className={s.excerpt}>{article.excerpt}</p>}
        </div>
      </div>
    </>
  )
}

function StoryActions({ article: base, onRead }: { article: Article; onRead: () => void }) {
  const article = useFlags(base)
  const t = useMessages()
  return (
    <div className={s.bottom}>
      <button className={s.readButton} onClick={onRead}>
        {t.stories.read}
      </button>
      <button
        className={cx(s.control, article.liked && s.liked)}
        onClick={() => setLiked(article, !article.liked)}
        aria-label={t.common.like}
        aria-pressed={article.liked}
      >
        <Heart size={26} />
      </button>
      <button
        className={cx(s.control, article.saved && s.saved)}
        onClick={() => setSaved(article, !article.saved)}
        aria-label={t.common.save}
        aria-pressed={article.saved}
      >
        <Bookmark size={26} />
      </button>
      <button className={s.control} onClick={() => void shareArticle(article)} aria-label={t.common.share}>
        <Send size={24} />
      </button>
    </div>
  )
}
