import Database from 'better-sqlite3'

export type DB = Database.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  topic_id INTEGER NOT NULL REFERENCES topics(id),
  title TEXT NOT NULL,
  site_url TEXT NOT NULL,
  feed_url TEXT NOT NULL UNIQUE,
  icon_url TEXT,
  followed INTEGER NOT NULL DEFAULT 1,
  etag TEXT,
  last_modified TEXT,
  fetched_at INTEGER,
  error TEXT
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  image_checked INTEGER NOT NULL DEFAULT 0,
  author TEXT,
  published_at INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  seen_at INTEGER,
  read_at INTEGER,
  liked_at INTEGER,
  saved_at INTEGER,
  hidden_at INTEGER
);
CREATE INDEX IF NOT EXISTS articles_by_time ON articles(published_at DESC, id DESC);
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
  phrase TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
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
  bullets TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS briefings (
  day TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_days (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
`

export function openDb(path: string): DB {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
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
  published_at: number
  seen_at: number | null
  read_at: number | null
  liked_at: number | null
  saved_at: number | null
  source_id: number
  source_title: string
  source_icon: string | null
  source_site: string
  topic_slug: string
  topic_name: string
  has_summary: number
}

export const ARTICLE_COLUMNS = `
  a.id, a.url, a.title, a.excerpt, a.image_url, a.author, a.published_at,
  a.seen_at, a.read_at, a.liked_at, a.saved_at,
  s.id AS source_id, s.title AS source_title, s.icon_url AS source_icon, s.site_url AS source_site,
  t.slug AS topic_slug, t.name AS topic_name,
  EXISTS (SELECT 1 FROM summaries m WHERE m.article_id = a.id) AS has_summary
`

export const ARTICLE_FROM = `
  FROM articles a
  JOIN sources s ON s.id = a.source_id
  JOIN topics t ON t.id = s.topic_id
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
    source: { id: row.source_id, title: row.source_title, icon: row.source_icon, site: row.source_site },
    topic: { slug: row.topic_slug, name: row.topic_name },
  }
}

export type Article = ReturnType<typeof toArticle>
