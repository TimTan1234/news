import { useState } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { today, type Stats } from '../api/client.ts'
import { useStats } from '../api/hooks.ts'
import { TileGrid } from '../components/Feed.tsx'
import { Empty, TopBar, cx, ui } from '../components/ui.tsx'
import { weekday } from '../lib/format.ts'
import p from './pages.module.css'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function WeekChart({ week }: { week: Stats['week'] }) {
  const peak = Math.max(1, ...week.map((entry) => entry.count))
  return (
    <figure className={p.chart}>
      <figcaption className={p.chartTitle}>Stories read this week</figcaption>
      <ol className={p.bars}>
        {week.map((entry) => (
          <li
            key={entry.day}
            className={cx(p.barSlot, entry.day === today() && p.barToday)}
            tabIndex={0}
            aria-label={`${new Date(`${entry.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })}: ${plural(entry.count, 'story').replace('storys', 'stories')}`}
          >
            <span className={p.barValue}>{entry.count}</span>
            <span className={p.bar} style={{ height: `${(entry.count / peak) * 100}%` }} />
            <span className={p.barDay}>{weekday(entry.day)}</span>
          </li>
        ))}
      </ol>
    </figure>
  )
}

function TopicChart({ topics }: { topics: Stats['topics'] }) {
  const peak = Math.max(1, ...topics.map((topic) => topic.count))
  return (
    <figure className={p.chart}>
      <figcaption className={p.chartTitle}>By topic, last 30 days</figcaption>
      <ul className={p.topicBars}>
        {topics.map((topic) => (
          <li key={topic.slug} className={p.topicRow}>
            <span className={p.topicName}>{topic.name}</span>
            <span className={p.topicTrack}>
              <span className={p.topicFill} style={{ width: `${(topic.count / peak) * 100}%` }} />
            </span>
            <span className={p.topicCount}>{topic.count}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function Profile() {
  const { data: stats } = useStats()
  const [tab, setTab] = useState<'saved' | 'liked'>('saved')

  return (
    <div className={cx(p.page, p.wide)}>
      <TopBar title="Profile">
        <Link to="/settings" className={ui.iconButton} aria-label="Settings">
          <SettingsIcon size={22} />
        </Link>
      </TopBar>

      {stats && (
        <>
          <dl className={p.tiles}>
            {[
              [stats.streak, 'day streak'],
              [stats.today, 'read today'],
              [stats.saved, 'saved'],
            ].map(([value, label]) => (
              <div key={label} className={p.tile}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className={p.charts}>
            <WeekChart week={stats.week} />
            {stats.topics.length > 0 && <TopicChart topics={stats.topics} />}
          </div>
        </>
      )}

      <div className={p.tabs} role="tablist">
        {(['saved', 'liked'] as const).map((name) => (
          <button key={name} role="tab" aria-selected={tab === name} className={cx(p.tab, tab === name && p.tabActive)} onClick={() => setTab(name)}>
            {name === 'saved' ? 'Saved' : 'Liked'}
          </button>
        ))}
      </div>
      <TileGrid
        key={tab}
        params={{ filter: tab }}
        empty={
          tab === 'saved' ? (
            <Empty title="Nothing saved yet">Tap the bookmark on a story to keep it here.</Empty>
          ) : (
            <Empty title="No likes yet">Double-tap a story's image to like it.</Empty>
          )
        }
      />
    </div>
  )
}
