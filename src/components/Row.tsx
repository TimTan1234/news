import type { Article } from '../api/client.ts'
import { ago } from '../lib/format.ts'
import { useOverlay } from '../lib/overlay.ts'
import { Media, useImage } from './Post.tsx'
import { Avatar } from './ui.tsx'
import s from './row.module.css'

export function ArticleRow({ article, fresh = false }: { article: Article; fresh?: boolean }) {
  const overlay = useOverlay()
  const image = useImage(article)
  return (
    <button className={s.row} onClick={() => overlay.open('read', article.id)}>
      <span className={s.text}>
        <span className={s.byline}>
          <Avatar title={article.source.title} icon={article.source.icon} size={20} />
          <span className={s.source}>{article.source.title}</span>
          <span className={s.age}>{ago(article.publishedAt)}</span>
          {fresh && <span className={s.fresh} aria-label="New" />}
        </span>
        <span className={s.title}>{article.title}</span>
      </span>
      {image.src && (
        <span className={s.thumb}>
          <Media article={article} image={image} compact />
        </span>
      )}
    </button>
  )
}
