/** Runs inside a tiktok.com page: the signed-in account's handle, from the link to its own profile. */
export function tiktokHandle() {
  const link = document.querySelector('[data-e2e="nav-profile"] a[href*="/@"], a[data-e2e="nav-profile"][href*="/@"], [data-e2e="nav-profile"][href*="/@"]')
  const handle = ((link && link.getAttribute('href')) || '').match(/\/@([\w.-]{2,24})/)
  return { handle: handle ? handle[1] : null, loginButton: Boolean(document.querySelector('[data-e2e="top-login-button"]')), page: document.title.slice(0, 60) }
}

/** Runs inside the page: opens one of the profile's tabs. */
export function tiktokTab(selectors) {
  const tab = document.querySelector(selectors)
  if (tab) tab.click()
  return Boolean(tab)
}

/**
 * Runs inside the page: the favourites are split into videos, collections, sounds and more, each
 * behind a sub-tab. Opens the one for videos and returns its name.
 */
export function tiktokVideosTab() {
  const tabs = [...document.querySelectorAll('[data-e2e^="sub-tab-"]')]
  const name = (tab) => tab.getAttribute('data-e2e')
  const wanted = tabs.find((tab) => /post|video/i.test(name(tab))) || tabs.find((tab) => !/collection|sound|music|effect|place|hashtag|book|movie|product/i.test(name(tab)))
  if (wanted) wanted.click()
  return wanted ? name(wanted) : null
}

/**
 * Runs inside the page: the videos in the list that is showing, each linking to /@<handle>/video/<id>.
 * A list the page does not name can be read `unnamed`: every video outside the lists it does name.
 */
export function tiktokCards(roots, limit, unnamed) {
  const root = document.querySelector(roots)
  const within = (node) => [...node.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]')]
  const links = root ? within(root) : unnamed ? within(document).filter((link) => !link.closest('[data-e2e$="-item-list"]')) : []
  const seen = new Set()
  const cards = []
  for (const link of links) {
    const href = link.getAttribute('href') || ''
    const id = (href.match(/\/(?:video|photo)\/(\d{6,})/) || [])[1]
    if (!id || seen.has(id)) continue
    seen.add(id)
    const card = link.closest('[data-e2e$="-item"], li, [class*="ItemContainer"]') || link
    const picture = link.querySelector('img[alt]') || card.querySelector('img[alt]')
    const caption = card.querySelector('[data-e2e="video-desc"], [class*="title"], [class*="desc"]')
    const title = link.getAttribute('aria-label') || link.getAttribute('title') || (picture && picture.getAttribute('alt')) || (caption && caption.textContent) || ''
    cards.push({ id, title: String(title).replace(/\s+/g, ' ').trim().slice(0, 200), by: (href.match(/\/@([\w.-]+)\//) || [])[1] || null })
    if (cards.length >= limit) break
  }
  if (root || cards.length) return { found: true, cards, links: links.length }
  // With no list to read, what the page does hold says where to look next.
  const marks = [...new Set([...document.querySelectorAll('[data-e2e]')].map((node) => node.getAttribute('data-e2e')))].filter((mark) => /fav|collect|list|sub-tab/i.test(mark))
  return { found: false, cards, links: 0, marks: marks.slice(0, 12).join(' '), loose: within(document).length }
}

/** Runs inside the page: goes to the foot of the list, which is what makes the site fetch the videos after it. */
export function toEnd() {
  window.scrollTo(0, document.documentElement.scrollHeight)
}

/** How many videos of a list are enough. */
const LIMIT = 60

const LISTS = [
  { kind: 'liked', tabs: '[data-e2e="liked-tab"], [data-e2e="user-liked-tab"], [data-e2e="user-tab-liked"]', roots: '[data-e2e="user-liked-item-list"], [data-e2e="liked-video-list"]' },
  { kind: 'saved', tabs: '[data-e2e="favorites-tab"], [data-e2e="user-favorites-tab"], [data-e2e="user-tab-favorites"]', roots: '[data-e2e="user-favorites-item-list"], [data-e2e="favorite-video-list"]', split: true },
]

/** Reads the signed-in account's liked and favourite videos from the tabs of its own profile. */
export async function read({ open, go, close, inPage, until, wait, signedIn }) {
  if (!(await signedIn('https://www.tiktok.com', ['sessionid', 'sessionid_ss']))) return { problem: 'signed_out' }
  const tab = await open('https://www.tiktok.com/')
  try {
    let home = null
    await until(async () => {
      home = await inPage(tab, tiktokHandle)
      return home && (home.handle || home.loginButton)
    }, 12_000)
    if (!home?.handle) return home?.loginButton ? { problem: 'signed_out' } : { problem: 'unreadable', detail: `no profile link on "${home?.page ?? ''}"` }

    await wait(2000)
    await go(tab, `https://www.tiktok.com/@${home.handle}`)
    const items = []
    const notes = []
    for (const list of LISTS) {
      await wait(2000)
      const opened = await until(() => inPage(tab, tiktokTab, [list.tabs]), 10_000)
      let seen = null
      let part = null
      if (opened && list.split) {
        await wait(1500)
        part = await until(() => inPage(tab, tiktokVideosTab), 3000)
        await wait(1500)
      }
      if (opened) {
        // The videos arrive a screen at a time, so the list is taken once it has stopped growing.
        let count = -1
        let steady = 0
        await until(async () => {
          seen = await inPage(tab, tiktokCards, [list.roots, LIMIT, Boolean(list.split)])
          const now = seen ? seen.cards.length : 0
          steady = now === count ? steady + 1 : 0
          count = now
          if (now >= LIMIT || steady >= (now ? 4 : 16)) return true
          if (now) await inPage(tab, toEnd)
          return false
        }, 20_000)
      }
      const found = (seen?.cards ?? []).flatMap((card) => (card.title ? [{ kind: list.kind, ref: card.id, title: card.title, by: card.by }] : []))
      const instead = seen && !seen.found ? ` (page has ${seen.marks || 'no lists'}, ${seen.loose} videos)` : ''
      notes.push(`${list.kind}: tab ${opened ? `opened${part ? ` (${part})` : ''}` : 'missing'}, list ${seen?.found ? 'found' : `missing${instead}`}, ${seen?.links ?? 0} links, ${found.length} titled`)
      items.push(...found)
    }
    const detail = notes.join('; ')
    return items.length ? { account: home.handle, items, detail } : { problem: 'unreadable', detail }
  } finally {
    await close(tab)
  }
}
