/**
 * Runs inside an instagram.com page, so it must stand alone. Asks the site's own API, as the
 * signed-in reader, for the posts they saved and the accounts they follow.
 */
export async function instagramLists() {
  const notes = []
  const id = (document.cookie.match(/(?:^|;\s*)ds_user_id=(\d+)/) || [])[1]
  if (!id) return { signedOut: true, notes }
  const get = async (path) => {
    const name = path.split('?')[0].replace(/\/\d+\//, '/:id/')
    try {
      const res = await fetch(path, { credentials: 'include', headers: { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' } })
      notes.push(`${name} ${res.status}`)
      return res.ok ? await res.json() : null
    } catch {
      notes.push(`${name} failed`)
      return null
    }
  }

  const items = []
  const saved = await get('/api/v1/feed/saved/posts/')
  for (const row of (saved && saved.items) || []) {
    const media = row.media || row
    // A post has no title; the first line of its caption stands in for one.
    const caption = String((media.caption && media.caption.text) || media.accessibility_caption || '').split('\n')[0].trim().slice(0, 160)
    const ref = media.code || media.pk
    if (ref && caption) items.push({ kind: 'saved', ref: String(ref), title: caption, by: (media.user && media.user.username) || null })
  }
  const following = await get(`/api/v1/friendships/${id}/following/?count=50`)
  for (const user of (following && following.users) || []) {
    if (user.username) items.push({ kind: 'followed', ref: String(user.pk || user.username), title: user.full_name || user.username, by: null })
  }
  return { items, notes }
}

export async function read({ open, close, inPage, signedIn }) {
  if (!(await signedIn('https://www.instagram.com', ['sessionid']))) return { problem: 'signed_out' }
  const tab = await open('https://www.instagram.com/')
  try {
    const found = await inPage(tab, instagramLists)
    if (!found || found.signedOut) return { problem: 'signed_out' }
    const detail = found.notes.join('; ')
    return found.items.length ? { account: '', items: found.items, detail } : { problem: 'unreadable', detail }
  } finally {
    await close(tab)
  }
}
