import { renameSync } from 'node:fs'
import Database from 'better-sqlite3'

export type DB = Database.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, slug)
);

-- kind 'feed' is a source the user manages; 'results' is the hidden bucket that holds one-off search results.
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  topic_id INTEGER REFERENCES topics(id),
  kind TEXT NOT NULL DEFAULT 'feed',
  title TEXT NOT NULL,
  site_url TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  icon_url TEXT,
  followed INTEGER NOT NULL DEFAULT 1,
  etag TEXT,
  last_modified TEXT,
  fetched_at INTEGER,
  error TEXT,
  UNIQUE (user_id, feed_url)
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  source_id INTEGER NOT NULL REFERENCES sources(id),
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  image_checked INTEGER NOT NULL DEFAULT 0,
  author TEXT,
  publisher TEXT,
  published_at INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  seen_at INTEGER,
  read_at INTEGER,
  liked_at INTEGER,
  saved_at INTEGER,
  hidden_at INTEGER,
  UNIQUE (user_id, url)
);
CREATE INDEX IF NOT EXISTS articles_by_time ON articles(user_id, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS articles_by_source ON articles(source_id, published_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title, excerpt, content='articles', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS articles_fts_insert AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, excerpt) VALUES (new.id, new.title, new.excerpt);
END;
CREATE TRIGGER IF NOT EXISTS articles_fts_delete AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, excerpt) VALUES ('delete', old.id, old.title, old.excerpt);
END;

CREATE TABLE IF NOT EXISTS trackers (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  phrase TEXT NOT NULL COLLATE NOCASE,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, phrase)
);

CREATE TABLE IF NOT EXISTS tracker_hits (
  tracker_id INTEGER NOT NULL REFERENCES trackers(id),
  article_id INTEGER NOT NULL REFERENCES articles(id),
  created_at INTEGER NOT NULL,
  seen_at INTEGER,
  PRIMARY KEY (tracker_id, article_id)
);

CREATE TABLE IF NOT EXISTS reader_cache (
  article_id INTEGER PRIMARY KEY REFERENCES articles(id),
  html TEXT,
  text TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS summaries (
  article_id INTEGER PRIMARY KEY REFERENCES articles(id),
  lang TEXT NOT NULL,
  bullets TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS briefings (
  user_id INTEGER NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,
  lang TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS reading_days (
  user_id INTEGER NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
`

function connect(path: string): DB {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

/** A database written before accounts existed has no owner for its rows. */
function predatesAccounts(db: DB): boolean {
  const columns = db.prepare(`SELECT name FROM pragma_table_info('sources')`).pluck().all() as string[]
  return columns.length > 0 && !columns.includes('user_id')
}

export function openDb(path: string): DB {
  let db = connect(path)
  if (predatesAccounts(db)) {
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
    const kept = path.replace(/\.db$/, '-before-accounts.db')
    renameSync(path, kept)
    console.warn(`The existing database has no accounts and was set aside as ${kept}; starting a new one.`)
    db = connect(path)
  }
  db.exec(SCHEMA)
  return db
}

export function deleteArticles(db: DB, where: string, ...params: unknown[]): number {
  const ids = db.prepare(`SELECT id FROM articles WHERE ${where}`).pluck().all(...params) as number[]
  if (ids.length === 0) return 0
  const drop = db.transaction(() => {
    const dependents = ['tracker_hits', 'reader_cache', 'summaries'].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE article_id = ?`),
    )
    const article = db.prepare('DELETE FROM articles WHERE id = ?')
    for (const id of ids) {
      for (const stmt of dependents) stmt.run(id)
      article.run(id)
    }
  })
  drop()
  return ids.length
}

export interface ArticleRow {
  id: number
  url: string
  title: string
  excerpt: string
  image_url: string | null
  author: string | null
  publisher: string | null
  published_at: number
  seen_at: number | null
  read_at: number | null
  liked_at: number | null
  saved_at: number | null
  source_id: number
  source_kind: string
  source_title: string
  source_icon: string | null
  source_site: string
  topic_slug: string | null
  topic_name: string | null
  has_summary: number
}

export const ARTICLE_COLUMNS = `
  a.id, a.url, a.title, a.excerpt, a.image_url, a.author, a.publisher, a.published_at,
  a.seen_at, a.read_at, a.liked_at, a.saved_at,
  s.id AS source_id, s.kind AS source_kind, s.title AS source_title, s.icon_url AS source_icon, s.site_url AS source_site,
  t.slug AS topic_slug, t.name AS topic_name,
  EXISTS (SELECT 1 FROM summaries m WHERE m.article_id = a.id) AS has_summary
`

export const ARTICLE_FROM = `
  FROM articles a
  JOIN sources s ON s.id = a.source_id
  LEFT JOIN topics t ON t.id = s.topic_id
`

export const ARTICLE_SELECT = `SELECT ${ARTICLE_COLUMNS} ${ARTICLE_FROM}`

export function toArticle(row: ArticleRow) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    excerpt: row.excerpt,
    image: row.image_url,
    author: row.author,
    publishedAt: row.published_at,
    seen: row.seen_at !== null,
    read: row.read_at !== null,
    liked: row.liked_at !== null,
    saved: row.saved_at !== null,
    hasSummary: row.has_summary === 1,
    source: {
      id: row.source_id,
      // Search results name the outlet that published each item; the source row only names the search.
      title: row.publisher ?? row.source_title,
      icon: row.source_icon,
      site: row.source_site,
      managed: row.source_kind === 'feed',
    },
    topic: row.topic_slug && row.topic_name ? { slug: row.topic_slug, name: row.topic_name } : null,
  }
}

export type Article = ReturnType<typeof toArticle>
