# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner, plus a few family members or friends with accounts on the same self-hosted instance. Each person has their own topics, sources, keywords, likes, saves, reading stats and connected accounts. Readers move between English and Simplified Chinese; the interface follows the browser language until a reader picks one.

The typical session is on a phone, in spare moments: scroll the stories rail and the feed, like or save, open one or two articles. Desktop is secondary and is where longer reading, the briefing and Settings tend to happen.

## Product Purpose

Pulse is a personal news tracker laid out like a social feed. It follows RSS and Atom feeds grouped by topic, searches outside platforms for tracked keywords and learned interests, and presents all of it as stories, posts and a searchable grid. Success is that a short scroll leaves the reader caught up on their subjects and shown a few things they would not have found themselves.

## Positioning

Four things together, none of which a conventional feed reader offers as a set:

- **Social-feed format.** News is read the way a social app is scrolled: a stories rail with one ring per source, a chronological post feed, double-tap to like, tap to read.
- **Chinese and Western sources in one feed.** Bilibili, Weibo, Zhihu and Xiaohongshu sit beside RSS, YouTube, Hacker News, GitHub and general news search, with a fully bilingual interface.
- **Suggestions that learn.** Interests come from tracked keywords, from likes, saves, reads and hides, and from connected Bilibili and YouTube accounts. A quarter of suggestion slots are held for subjects outside the reader's usual taste, and feedback moves a subject between trial, standing, resting and stopped.
- **Private and self-hosted.** Data, logins and reading history stay on the owner's machine. Pulse only reads connected accounts; it never likes, follows or posts.

## Operating Context

- Runs in Docker Compose on the owner's machine (port 3031), alongside RSSHub and a patched xiaohongshu-mcp service; anyone who can reach the address can register.
- Feeds refresh every 15 minutes; stories older than 30 days are removed unless read, liked or saved.
- Suggestions run about once a day per account, within platform quotas (YouTube at most four searches a round, Xiaohongshu at most three).
- The briefing is a daily digest of the last 24 hours, written once per day unless regenerated.
- Keyboard shortcuts exist for desktop reading (`j`/`k`, `l`, `s`, `o`, `/`, arrows, `Esc`).

## Capabilities and Constraints

- Surfaces: Home (stories rail, topic filters, feed), Reader (extracted article text with link to original), Explore (suggestions, then feed search and outside search with Follow), Briefing, Activity (tracked keywords and every matching story), Profile (streak, weekly and per-topic counts, saved and liked), Settings (theme, language, interests, sources, topics, connected accounts, OPML, sign out), Auth.
- Stack: React 19 + Vite + React Router + TanStack Query on the client, CSS modules with tokens in `src/styles/tokens.css`; Fastify + better-sqlite3 on the server; Vitest.
- AI features degrade to rules without keys. `ANTHROPIC_API_KEY` enables summaries, the briefing, proposed interests and per-suggestion reasons, written in the interface language. `GEMINI_API_KEY` adds relevance scoring.
- Platform availability varies per instance: Weibo and Zhihu need cookies, YouTube needs an API key and an OAuth client, Xiaohongshu needs the admin to connect a dedicated account. The interface must read correctly when any of these are absent.
- Xiaohongshu is one shared login for the whole instance, visible and manageable only by the admin; its notes open on the site, not in the Reader.
- Every piece of interface copy exists in English and Simplified Chinese (`src/i18n/en.ts`, `src/i18n/zh.ts`).

## Brand Commitments

- Name: **Pulse**.
- Voice: plain, short, declarative sentences that say what happens ("Feeds refresh every 15 minutes", "Pulse only reads these accounts"). No marketing tone.
- Bilingual parity: Chinese is a first-class interface language, not a translation afterthought.

## Evidence on Hand

- Real content comes from the reader's own feeds and searches; there are no testimonials, customers, usage numbers or press, and none should be invented.
- The suggestion approach follows OpenBiliClaw's interest probes, feedback ladder and diversity selection, credited in the README.

## Product Principles

1. **A short scroll should be enough.** Optimise for catching up on a phone in a few minutes; depth is one tap away, never in the way.
2. **One feed, many worlds.** Chinese and Western platforms are equals in the feed, in search and in copy.
3. **Discovery is deliberate.** Suggestions show why they appear and leave room for subjects outside the usual; feedback is cheap and reversible.
4. **The reader owns it.** Self-hosted, read-only toward other platforms, and honest about what is connected, expired or unavailable.
5. **Degrade quietly.** Missing keys, cookies or connections remove a capability without breaking the surface around it.

## Accessibility & Inclusion

- Mixed Latin and CJK text throughout; type and layout must hold for both scripts.
- Reduced-motion preference is honoured; keyboard navigation covers the core reading loop.
