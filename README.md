# Pulse

A personal news tracker laid out like a social feed. It follows RSS and Atom feeds grouped by topic (AI, Games and Tech to start) and shows them as stories, posts and a searchable grid. The interface is available in English and Simplified Chinese.

## Run with Docker

```sh
cp .env.example .env        # optional: add ANTHROPIC_API_KEY for summaries and the briefing
docker compose up -d --build
```

Open http://localhost:3031 and create an account. The database lives in the `pulse-data` volume and survives rebuilds.

Compose also starts [RSSHub](https://docs.rsshub.app), which Pulse uses for Weibo search and Zhihu feeds. Both sites only answer signed-in visitors, so put your cookies in `.env` as `WEIBO_COOKIES` and `ZHIHU_COOKIES` to use them.

## Run locally

Node 22 is required.

```sh
npm install
npm run dev                 # server on :3000, client on :5173 with hot reload
```

For a production-style run on one port: `npm run build && npm start`. The database is written to `data/pulse.db`; set `DATA_DIR` to move it and `PORT` to change the port. Set `RSSHUB_URL` to an RSSHub instance to turn on Weibo search.

## Accounts

Each person creates their own account from the sign-in screen and gets their own topics, sources, keywords, likes, saves and reading stats. Anyone who can reach the address can register, so keep it on a network you trust.

A database from before accounts existed is kept beside the new one as `pulse-before-accounts.db` and is not carried over.

## What it does

- **Home**: a stories rail with one ring per source, topic filters, and a chronological feed. Double-tap an image to like it, tap to read.
- **Reader**: the article text extracted in place, with a link to the original.
- **Explore**: search your feed, or carry the same search on to the news, Bilibili and Weibo. Any outside search can be followed, which adds its new results to your feed.
- **Briefing**: a daily digest of the last 24 hours, written by Claude.
- **Activity**: keywords you track, with every story that mentions them.
- **Profile**: reading streak, weekly and per-topic counts, saved and liked stories.
- **Settings**: theme, language, sources, topics, OPML import and export, and signing out.

Feeds refresh every 15 minutes. Stories older than 30 days are removed unless you read, liked or saved them.

## Adding sources

In Settings, paste any of these into the address field:

- a site's address, such as `theverge.com` — Pulse looks for the feed it advertises
- a feed's own address, such as `https://www.theverge.com/rss/index.xml`
- an RSSHub route, such as `http://rsshub:1200/zhihu/hot` for Zhihu's hot list ([all routes](https://docs.rsshub.app/routes/))

To follow a subject instead of a site, search for it in Explore, pick News, Bilibili or Weibo, and choose **Follow this search**.

## AI features

Summaries and the briefing call the Claude API and need `ANTHROPIC_API_KEY` in `.env`. Both are written in the language the interface is set to. Each summary is stored after the first request, and the briefing is written once per day unless you ask for a new one. The model is set in `server/ai.ts`.

## Keyboard

| Key | Action |
|---|---|
| `j` / `k` | Next / previous post |
| `l` | Like |
| `s` | Save |
| `o` | Open in the reader |
| `/` | Search |
| `←` / `→` | Previous / next story in the viewer |
| `Esc` | Close the reader or viewer |

## Tests

```sh
npm test
```
