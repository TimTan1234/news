# Pulse

A personal news tracker laid out like a social feed. It follows RSS and Atom feeds grouped by topic (AI, Games and Tech to start) and shows them as stories, posts and a searchable grid. The interface is available in English and Simplified Chinese.

## Run with Docker

```sh
cp .env.example .env        # optional: add ANTHROPIC_API_KEY for summaries and the briefing
docker compose up -d --build
```

Open http://localhost:3031 and create an account. The database lives in the `pulse-data` volume and survives rebuilds.

Compose also starts [RSSHub](https://docs.rsshub.app), which Pulse uses for Weibo search and Zhihu feeds. Both sites only answer signed-in visitors, so put your cookies in `.env` as `WEIBO_COOKIES` and `ZHIHU_COOKIES` to use them. It also builds the service behind [Xiaohongshu search](#xiaohongshu).

## Run locally

Node 22 is required.

```sh
npm install
npm run dev                 # server on :3000, client on :5173 with hot reload
```

For a production-style run on one port: `npm run build && npm start`. The database is written to `data/pulse.db`; set `DATA_DIR` to move it and `PORT` to change the port. Set `RSSHUB_URL` to an RSSHub instance to turn on Weibo search, and `XHS_MCP_URL` to a xiaohongshu-mcp address (`http://localhost:18060/mcp`) for Xiaohongshu.

## Accounts

Each person creates their own account from the sign-in screen and gets their own topics, sources, keywords, likes, saves and reading stats. Anyone who can reach the address can register, so keep it on a network you trust.

A database from before accounts existed is kept beside the new one as `pulse-before-accounts.db` and is not carried over.

## What it does

- **Home**: a stories rail with one ring per source, topic filters, and a chronological feed. Double-tap an image to like it, tap to read.
- **Reader**: the article text extracted in place, with a link to the original.
- **Explore**: stories suggested for you from outside your own sources, each with the subject it was found for. Below that, search your feed or carry the same search on to the news, Bilibili, Weibo, YouTube, Xiaohongshu, Hacker News and GitHub. Any outside search can be followed, which adds its new results to your feed.
- **Briefing**: a daily digest of the last 24 hours, written by Claude.
- **Activity**: keywords you track, with every story that mentions them, whether it came from your sources or from a news, Bilibili, Weibo or Hacker News search for the keyword.
- **Profile**: reading streak, weekly and per-topic counts, saved and liked stories.
- **Settings**: theme, language, interests, sources, topics, connected accounts, OPML import and export, and signing out.

Feeds refresh every 15 minutes. Stories older than 30 days are removed unless you read, liked or saved them.

## Suggestions

Pulse keeps a list of interests for each account and, about once a day, searches every platform it can reach for them.

- **Learning.** Tracked keywords are always interests. Beyond those, Pulse reads what you liked, saved, read and hid, along with what you watch, like, save and follow on the [accounts you connect](#connected-accounts), and proposes new subjects: some plainly in your history, some next to it, and a few from somewhere else entirely.
- **Finding and ranking.** Each interest is searched on every available platform. Stories you have already seen, or that one of your sources already carries, are left out. The rest are scored for relevance and freshness, then picked so that no subject, publisher or platform crowds out the others, with a quarter of the places held for the subjects outside your usual tastes.
- **Feedback.** Liking, saving or reading a suggestion counts for its subject; **Not interested** counts against it. A subject on trial becomes a standing one after two of its stories are taken up. One that keeps being passed over rests for 7 days, then 14, then 30. **Don't suggest…** stops a subject for good; Settings lists every interest and can stop or restore it.
- **Following.** The Follow button on a suggestion offers the site's own feed, a search for the subject, or both, and files your choice under an existing topic or a new one.

Without any keys this runs on rules: interests are your tracked keywords and the names that recur in what you like, and relevance is judged by where the phrase appears. `ANTHROPIC_API_KEY` adds proposed interests and a one-line reason on each suggestion; `GEMINI_API_KEY` adds relevance scoring by the Gemini Decisions API. `YOUTUBE_API_KEY` adds YouTube, which allows about 100 searches a day, so a round spends at most four there. Connecting a Xiaohongshu account adds that platform; a round spends at most three searches there.

The approach follows [OpenBiliClaw](https://github.com/whiteguo233/OpenBiliClaw)'s interest probes, feedback ladder and diversity selection.

## Adding sources

In Settings, paste any of these into the address field:

- a site's address, such as `theverge.com` — Pulse looks for the feed it advertises
- a feed's own address, such as `https://www.theverge.com/rss/index.xml`
- an RSSHub route, such as `http://rsshub:1200/zhihu/hot` for Zhihu's hot list ([all routes](https://docs.rsshub.app/routes/))

To follow a subject instead of a site, search for it in Explore, pick a platform, and choose **Follow this search**. A followed YouTube, Xiaohongshu or GitHub search is run once a day; the others run with every refresh.

## Connected accounts

Suggestions can learn from what you do on other platforms. Each person connects their own accounts in Settings, under Connected accounts, and a new account gets its first interests from them straight away.

- **Bilibili.** Choose **Connect** and scan the QR code with the Bilibili app. Pulse reads your recent watch history (videos you finished or stayed with), your likes, the newest videos in your default favourites folder, and the creators you follow.
- **YouTube.** Choose **Connect**, open the address shown and enter the code. Pulse reads your liked videos and your subscriptions; YouTube does not give out watch history. This needs a Google OAuth client: in the Google Cloud console enable "YouTube Data API v3", set up the consent screen, create an OAuth client ID of type "TVs and Limited Input devices", and put its id and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. While the consent screen is in "Testing", Google ends the sign-in after 7 days; publish it to keep it.

- **Xiaohongshu, Douyin, Zhihu, TikTok and Instagram, through the browser extension.** These are read in your own Chrome, where you are already signed in, so Pulse never holds their logins. Load the `extension/` folder in Chrome (`chrome://extensions`, turn on Developer mode, **Load unpacked**), create a pairing key in Settings, and enter your Pulse address and the key on the extension's page. Every three days, while Chrome is open, the extension reads each site you are signed in to and sends the titles and authors to your Pulse; **Read now** does one site at once.

  | Site | What is read |
  |---|---|
  | Xiaohongshu | notes you saved and liked |
  | Douyin | videos you liked and added to favourites |
  | Zhihu | what you read, upvoted and collected |
  | TikTok | videos you liked and added to favourites |
  | Instagram | posts you saved and accounts you follow |

  It needs desktop Chrome with the site signed in. A site that changes its pages stops being read until the extension is updated; the extension's page shows what each read found.

Accounts are read when they are connected and again before a round of suggestions, at most twice a day. Each login and what was read with it are stored in the database, per account, and removed when you disconnect; interests already learned stay. With `ANTHROPIC_API_KEY` set, the titles and channel names are part of what Claude is given when it proposes interests. Pulse only reads these accounts: it never likes, follows or posts.

## Xiaohongshu

Xiaohongshu only answers a signed-in browser, so Compose builds and starts a service that keeps one login in a browser of its own and searches with it. The service is [xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) v2.7.4 with the two patches in `xiaohongshu-service/`: one lets it sign in from outside mainland China (its pull request #906), the other lets it use rednote.com. The login is stored in the `xiaohongshu-data` volume.

To connect, sign in as the admin, open Settings, choose **Connect** next to Xiaohongshu under Connected accounts, and scan the QR code with the app. Xiaohongshu then appears among the searches in Explore and Settings, and each round of suggestions searches it for up to three interests. Results are notes from the last week.

- **Which site.** An account registered with a phone number from outside China is a RedNote account and signs in on rednote.com, which is the default. For an account registered with a Chinese number, set `XHS_SITE_HOST=www.xiaohongshu.com` in `.env`.
- **Use an account made for this.** The service drives a signed-in browser, which Xiaohongshu's terms do not allow, and an account can be restricted for it. Pulse keeps the load small: searches run one at a time and never in the background refresh. Do not connect a personal account.
- **One login for everyone.** Every account on this Pulse searches through it. Only the admin sees it in Settings and can connect or disconnect it: that is the account named in `ADMIN_USER`, or the first one created when none is named.
- **Security checks.** New accounts, and ones without real-name verification, are checked more often. When Xiaohongshu asks for a check, Pulse stops searching until you pass it in the app and connect again.
- **One web session.** Signing in to the same site in another browser with the same account signs the service out. The phone app does not.
- **Logins expire.** Settings and the suggestions panel say when it has; a new scan restores it.
- **Notes open on the site.** They cannot be read inside Pulse, and notes without a title are left out.
- **Size.** The image is about 1.6 GB, runs on x86-64 only, and compiles the service on the first build. On an ARM machine, run the service on another computer and point `XHS_MCP_URL` at it, or take it out of `docker-compose.yml`.

## AI features

Summaries, the briefing and the written parts of suggestions call the Claude API and need `ANTHROPIC_API_KEY` in `.env`. Both are written in the language the interface is set to. Each summary is stored after the first request, and the briefing is written once per day unless you ask for a new one. The model is set in `server/ai.ts`.

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
