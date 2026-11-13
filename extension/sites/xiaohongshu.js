/**
 * Runs inside the page, so it must stand alone. Returns who is signed in and the notes of the
 * profile tab that is showing, read from the state the site keeps for its own use.
 */
export function pageState() {
  const unwrap = (ref) => (ref && ref.value !== undefined ? ref.value : ref && ref._value !== undefined ? ref._value : ref)
  const user = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.user
  if (!user) return null
  const me = unwrap(user.userInfo) || {}
  const active = unwrap(user.activeTab) || {}
  const lists = unwrap(user.notes)
  const shown = Array.isArray(lists) ? lists[active.index || 0] : null
  return {
    host: location.host,
    guest: Boolean(me.guest),
    id: me.userId || me.user_id || null,
    name: me.nickname || null,
    tab: active.query || null,
    notes: Array.isArray(shown)
      ? shown.slice(0, 60).map((note) => {
          const card = note.noteCard || {}
          const author = card.user || {}
          return { id: note.id || note.noteId || null, title: card.displayTitle || null, by: author.nickname || author.nickName || null }
        })
      : null,
  }
}

/** Runs inside the page: clicks the profile's sub-tab with one of these labels, or the one at this position. */
export function showTab(labels, position) {
  const tabs = [...document.querySelectorAll('.reds-tab-item.sub-tab-list')]
  const wanted = tabs.find((tab) => labels.includes(tab.textContent.trim())) || tabs[position]
  if (wanted) wanted.click()
  return Boolean(wanted)
}

/** Runs inside the page: goes to the foot of the list, which is what makes the site fetch the notes after it. */
export function toEnd() {
  window.scrollTo(0, document.documentElement.scrollHeight)
}

export function toActivity(kind, notes) {
  return (notes ?? []).flatMap((note) => {
    const title = note.title?.trim()
    return note.id && title ? [{ kind, ref: note.id, title, by: note.by?.trim() || null }] : []
  })
}

/** How many notes of a list are enough. */
const LIMIT = 60

/** The profile's sub-tabs, in the order the site shows them after the reader's own notes. */
const LISTS = [
  { tab: 'fav', kind: 'saved', labels: ['收藏', 'Collects', 'Collections', 'Saved'], position: 1 },
  { tab: 'liked', kind: 'liked', labels: ['点赞', 'Likes', 'Liked'], position: 2 },
]

/**
 * Reads the signed-in account's saved and liked notes. The site sends visitors from outside mainland
 * China to rednote.com, so the reading continues on whichever of the two hosts the first page lands on.
 */
export async function read({ open, go, close, inPage, until, wait }) {
  const tab = await open('https://www.xiaohongshu.com/explore')
  try {
    const first = await until(async () => {
      const state = await inPage(tab, pageState)
      return state && (state.id || state.guest) ? state : null
    }, 10_000)
    if (!first?.id || first.guest) return { problem: 'signed_out' }

    const items = []
    for (const list of LISTS) {
      await wait(3000)
      await go(tab, `https://${first.host}/user/profile/${first.id}?tab=${list.tab}&subTab=note`)
      const showing = () => until(async () => {
        const state = await inPage(tab, pageState)
        return state?.tab === list.tab && state.notes ? state : null
      }, 8000)
      let state = await showing()
      if (!state && (await inPage(tab, showTab, [list.labels, list.position]))) state = await showing()
      if (!state) continue
      // The notes arrive a screen at a time after the page itself, so the list is taken once it has stopped growing.
      let steady = 0
      await until(async () => {
        const now = await inPage(tab, pageState)
        if (now?.tab !== list.tab || !now.notes) return true
        steady = now.notes.length === state.notes.length ? steady + 1 : 0
        state = now
        if (state.notes.length >= LIMIT || steady >= (state.notes.length ? 4 : 10)) return true
        await inPage(tab, toEnd)
        return false
      }, 20_000)
      items.push(...toActivity(list.kind, state.notes))
    }
    return items.length ? { account: first.name ?? '', items } : { problem: 'unreadable' }
  } finally {
    await close(tab)
  }
}
