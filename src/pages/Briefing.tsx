import { useMutation } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api, today, type BriefingResult } from '../api/client.ts'
import { useBriefing } from '../api/hooks.ts'
import { queryClient } from '../api/query.ts'
import { ArticleRow } from '../components/Row.tsx'
import { Empty, TopBar, cx, ui } from '../components/ui.tsx'
import { clock, longDate } from '../lib/format.ts'
import p from './pages.module.css'

export function Briefing() {
  const briefing = useBriefing()
  const rewrite = useMutation({
    mutationFn: () => api<BriefingResult>('/api/briefing', { body: { day: today() } }),
    onSuccess: (result) => queryClient.setQueryData(['briefing', today()], result),
  })
  const busy = briefing.isPending || rewrite.isPending
  const error = rewrite.error ?? briefing.error
  const data = briefing.data

  return (
    <div className={p.page}>
      <TopBar title="Briefing">
        <button className={ui.iconButton} onClick={() => rewrite.mutate()} disabled={busy} aria-label="Write a new briefing">
          <RefreshCw size={21} className={cx(busy && p.spin)} />
        </button>
      </TopBar>

      {busy ? (
        <div className={p.briefing} aria-busy>
          <p className={p.dateline}>Reading today's headlines…</p>
          {[100, 94, 70].map((width) => (
            <span key={width} className={cx(p.line, ui.skeleton)} style={{ width: `${width}%`, height: 20 }} />
          ))}
          {[100, 86, 100, 62].map((width, index) => (
            <span key={index} className={cx(p.line, ui.skeleton)} style={{ width: `${width}%` }} />
          ))}
        </div>
      ) : error ? (
        <Empty title="The briefing was not written">{error.message}</Empty>
      ) : data?.briefing ? (
        <article className={p.briefing}>
          <p className={p.dateline}>
            {longDate(data.createdAt ?? Date.now())}, written at {clock(data.createdAt ?? Date.now())}
          </p>
          <p className={p.overview}>{data.briefing.overview}</p>
          {data.briefing.sections.map((section) => (
            <section key={section.topic} className={p.section}>
              <h2 className={p.sectionTitle}>{section.topic}</h2>
              {section.stories.map((story) => (
                <div key={story.title} className={p.story}>
                  <h3>{story.title}</h3>
                  <p>{story.summary}</p>
                  <div className={p.sources}>
                    {story.articleIds.map((id) => {
                      const article = data.articles?.[id]
                      return article ? <ArticleRow key={id} article={article} /> : null
                    })}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </article>
      ) : null}
    </div>
  )
}
