# Pulse

A personal news tracker laid out like a social feed. It follows RSS and Atom feeds grouped by topic (AI, Games and Tech to start) and shows them as stories, posts and a searchable grid.

## Run with Docker

```sh
cp .env.example .env        # optional: add ANTHROPIC_API_KEY for summaries and the briefing
docker compose up -d --build
```

Open http://localhost:3000. The database lives in the `pulse-data` volume and survives rebuilds.

## Run locally

Node 22 is required.

```sh
npm install
npm run dev                 # server on :3000, client on :5173 with hot reload
```

For a production-style run on one port: `npm run build && npm start`. The database is written to `data/pulse.db`; set `DATA_DIR` to move it and `PORT` to change the port.

## What it does

- **Home**: a stories rail with one ring per source, topic filters, and a chronological feed. Double-tap an image to like it, tap to read.
- **Reader**: the article text extracted in place, with a link to the original.
- **Explore**: full-text search, trending phrases, and an image grid.
- **Briefing**: a daily digest of the last 24 hours, written by Claude.
- **Activity**: keywords you track, with every story that mentions them.
- **Profile**: reading streak, weekly and per-topic counts, saved and liked stories.
- **Settings**: theme, sources (add one by pasting a site address), topics, and OPML import and export.

Feeds refresh every 15 minutes. Stories older than 30 days are removed unless you read, liked or saved them.

## AI features

Summaries and the briefing call the Claude API and need `ANTHROPIC_API_KEY` in `.env`. Each summary is stored after the first request, and the briefing is written once per day unless you ask for a new one. The model is set in `server/ai.ts`.

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
