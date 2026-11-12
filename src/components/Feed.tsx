import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import { CircleCheck } from 'lucide-react'
import type { Article, FeedParams } from '../api/client.ts'
import { useFeed, useLoadMore } from '../api/hooks.ts'
import { useOverlay } from '../lib/overlay.ts'
import { setLiked, setSaved, withFlags } from '../state/flags.ts'
import { Media, PostCard, PostSkeleton, useImage } from './Post.tsx'
import { Empty, cx, ui } from './ui.tsx'
import s from './feed.module.css'

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

/** j / k move between posts; l likes, s saves and o opens the focused one. */
function useFeedKeys(items: Article[]): void {
  const overlay = useOverlay()
  const latest = useRef({ items, overlay })
  latest.current = { items, overlay }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      if (new URLSearchParams(location.search).has('read') || new URLSearchParams(location.search).has('story')) return
      const posts = [...document.querySelectorAll<HTMLElement>('[data-post]')]
      const focused = document.activeElement?.closest<HTMLElement>('[data-post]') ?? null

      if (event.key === 'j' || event.key === 'k') {
        const current = focused ? posts.indexOf(focused) : posts.findIndex((post) => post.getBoundingClientRect().bottom > 80) - 1
        const next = posts[Math.max(0, Math.min(posts.length - 1, current + (event.key === 'j' ? 1 : -1)))]
        next?.focus({ preventScroll: true })
        next?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        return
      }

      const article = latest.current.items.find((item) => String(item.id) === focused?.dataset.post)
      if (!article) return
      const flagged = withFlags(article)
      if (event.key === 'l') setLiked(article, !flagged.liked)
      if (event.key === 's') setSaved(article, !flagged.saved)
      if (event.key === 'o' || event.key === 'Enter') latest.current.overlay.open('read', article.id)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
}

export function Feed({ params, caughtUp = false, empty }: { params: FeedParams; caughtUp?: boolean; empty: ReactNode }) {
  const query = useFeed(params)
  const more = useLoadMore(query)
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  useFeedKeys(items)

  // The mark is fixed when the feed first loads, so the divider stays put while this visit's posts become seen.
  const mark = useRef<{ key: string; value: number | null } | null>(null)
  const key = JSON.stringify(params)
  const first = query.data?.pages[0]
  if (first && mark.current?.key !== key) mark.current = { key, value: first.seenMark ?? null }
  const seenMark = mark.current?.key === key ? mark.current.value : null
  const boundary = caughtUp && seenMark !== null ? items.findIndex((item) => item.publishedAt <= seenMark) : -1

  if (query.isPending) {
    return (
      <div>
        <PostSkeleton />
        <PostSkeleton />
      </div>
    )
  }
  if (query.isError) return <Empty title="The feed did not load">{query.error.message}</Empty>
  if (items.length === 0) return <>{empty}</>

  return (
    <div>
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {index === boundary && index > 0 && (
            <div className={s.caughtUp}>
              <CircleCheck size={40} strokeWidth={1.5} />
              <p>You're all caught up</p>
            </div>
          )}
          <PostCard article={item} />
        </Fragment>
      ))}
      <div ref={more} className={s.more}>
        {query.isFetchingNextPage && <PostSkeleton />}
      </div>
    </div>
  )
}

/** A photo tile carries its headline as a caption; a poster tile already is the headline. */
function Tile({ article, onOpen }: { article: Article; onOpen: () => void }) {
  const image = useImage(article)
  return (
    <button className={s.tile} onClick={onOpen} aria-label={article.title}>
      <Media article={article} image={image} compact />
      {image.src && (
        <span className={s.tileTitle}>
          <span>{article.title}</span>
        </span>
      )}
    </button>
  )
}

export function TileGrid({ params, empty }: { params: FeedParams; empty: ReactNode }) {
  const query = useFeed(params, { limit: 30 })
  const more = useLoadMore(query)
  const overlay = useOverlay()
  const items = query.data?.pages.flatMap((page) => page.items) ?? []

  if (query.isPending) {
    return (
      <div className={s.grid} aria-hidden>
        {Array.from({ length: 9 }, (_, index) => (
          <div key={index} className={cx(s.tile, ui.skeleton)} />
        ))}
      </div>
    )
  }
  if (query.isError) return <Empty title="Nothing loaded">{query.error.message}</Empty>
  if (items.length === 0) return <>{empty}</>

  return (
    <>
      <ul className={s.grid}>
        {items.map((item) => (
          <li key={item.id}>
            <Tile article={item} onOpen={() => overlay.open('read', item.id)} />
          </li>
        ))}
      </ul>
      <div ref={more} className={s.more} />
    </>
  )
}
