/**
 * Runs inside a douyin.com page, so it must stand alone. Douyin draws a profile's tabs from what it
 * already holds, so the videos are read from the cards on the page: each links to /video/<id>.
 */
export function douyinCards(limit) {
  const text = (node) => (node && node.textContent ? node.textContent.replace(/\s+/g, ' ').trim() : '')
  const links = [...document.querySelectorAll('a[href*="/video/"]')]
  const seen = new Set()
  const cards = []
  for (const link of links) {
    const id = ((link.getAttribute('href') || '').match(/\/video\/(\d+)/) || [])[1]
    if (!id || seen.has(id)) continue
    seen.add(id)
    const card = link.closest('li, [data-aweme-id], [class*="card"]') || link
    const picture = link.querySelector('img[alt]') || card.querySelector('img[alt]')
    const words = link.getAttribute('aria-label') || link.getAttribute('title') || (picture && picture.getAttribute('alt')) || text(card.querySelector('[class*="title"], [class*="desc"], p'))
    // A card's like count is text too, and is not a title.
    const title = /^[\d.,]+\s*[万亿wk]?\+?$/i.test(String(words || '').trim()) ? '' : words
    const named = text(card.querySelector('[class*="author-name"], [class*="nickname"], [class*="user-name"]')).replace(/^@\s*/, '')
    // A cover's description reads "author：caption"; where the card names no author, that is where it comes from.
    const [, lead, rest] = (!named && String(title || '').match(/^([^：:#]{1,30})[：:]\s*(\S.*)$/s)) || []
    cards.push({ id, title: String(rest || title || '').replace(/\s+/g, ' ').trim().slice(0, 120), by: named || (lead && lead.trim()) || null })
    if (cards.length >= limit) break
  }
  // What a card with no title is made of, as tags and the lengths of their texts: enough to see where a title would be.
  const untitled = links.find((link) => cards.some((card) => !card.title && (link.getAttribute('href') || '').includes(card.id)))
  const outline = (node) =>
    [node, ...node.querySelectorAll('*')]
      .slice(0, 10)
      .map((part) => {
        const marks = ['alt', 'aria-label', 'title'].filter((name) => part.hasAttribute(name)).map((name) => `${name}:${part.getAttribute(name).length}`)
        const own = [...part.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent.trim()).join('').length
        return `${part.tagName.toLowerCase()}${marks.length ? `[${marks.join(',')}]` : ''}${own ? `(${own})` : ''}`
      })
      .join('>')
  return { cards, links: links.length, name: text(document.querySelector('h1')), page: document.title.slice(0, 60), untitled: untitled ? outline(untitled.closest('li') || untitled) : null }
}

/** Runs inside the page: moves the list on by a screen, which is what makes Douyin fill in the cards further down. */
export function scrollOn() {
  const link = document.querySelector('a[href*="/video/"]')
  for (let node = link; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node.scrollBy(0, node.clientHeight)
  }
  window.scrollBy(0, window.innerHeight)
}

export function toActivity(kind, cards) {
  return cards.flatMap((card) => (card.id && card.title ? [{ kind, ref: card.id, title: card.title, by: card.by }] : []))
}

const LISTS = [
  { kind: 'liked', tab: 'like' },
  { kind: 'saved', tab: 'favorite_collection' },
]

/** Reads the signed-in account's liked and favourite videos from its own profile. */
export async function read({ open, go, close, inPage, until, wait, signedIn }) {
  if (!(await signedIn('https://www.douyin.com', ['sessionid', 'sessionid_ss']))) return { problem: 'signed_out' }
  const address = (tab) => `https://www.douyin.com/user/self?showTab=${tab}`
  const tab = await open(address(LISTS[0].tab))
  try {
    const items = []
    const notes = []
    let account = ''
    for (const [index, list] of LISTS.entries()) {
      if (index > 0) {
        await wait(3000)
        await go(tab, address(list.tab))
      }
      // The links arrive before their cover text does, so the cards are read once the titles have stopped coming.
      let seen = null
      let titled = -1
      let steady = 0
      await until(async () => {
        seen = await inPage(tab, douyinCards, [60])
        const now = seen ? seen.cards.filter((card) => card.title).length : 0
        steady = now > 0 && now === titled ? steady + 1 : 0
        titled = now
        if (!seen || seen.cards.length === 0) return false
        if (now === seen.cards.length || steady >= 4) return true
        await inPage(tab, scrollOn)
        return false
      }, 20_000)
      const found = toActivity(list.kind, seen?.cards ?? [])
      notes.push(`${list.tab}: ${seen?.links ?? 0} links, ${found.length} titled, "${seen?.page ?? ''}"${seen?.untitled ? `, untitled ${seen.untitled}` : ''}`)
      account ||= seen?.name ?? ''
      items.push(...found)
    }
    const detail = notes.join('; ')
    return items.length ? { account, items, detail } : { problem: 'unreadable', detail }
  } finally {
    await close(tab)
  }
}
