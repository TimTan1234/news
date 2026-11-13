/**
 * Runs inside a zhihu.com page, so it must stand alone. Asks the site's own API, as the signed-in
 * reader, for what they read, upvoted and collected. `notes` records how each request went.
 */
export async function zhihuLists() {
  const notes = []
  const get = async (path) => {
    const name = path.split('?')[0]
    try {
      const res = await fetch(path, { credentials: 'include' })
      notes.push(`${name} ${res.status}`)
      return res.ok ? await res.json() : null
    } catch {
      notes.push(`${name} failed`)
      return null
    }
  }
  const me = await get('/api/v4/me')
  const slug = me && (me.url_token || me.urlToken)
  if (!slug) return { signedOut: true, notes }

  const items = []
  const add = (kind, id, title, by) => {
    const text = String(title || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
    // Several answers to one question share its title; the question is counted once.
    if (id && text && !items.some((item) => item.kind === kind && item.title === text)) items.push({ kind, ref: String(id), title: text, by: by || null })
  }
  // An answer is known by its question; an article by its own title.
  const named = (content) => (content.type === 'answer' ? (content.question && content.question.title) || content.title : content.title) || content.excerpt

  for (const offset of [0, 20]) {
    const page = await get(`/api/v4/unify-consumption/read_history?offset=${offset}&limit=20`)
    for (const row of (page && page.data) || []) {
      const data = row.data || {}
      const content = data.content || {}
      // The history also lists the profiles and topics that were opened; only things to read count.
      if (!['answer', 'article', 'question', 'zvideo', 'pin'].includes(data.extra && data.extra.content_type)) continue
      add('watched', data.extra && data.extra.content_token, (data.header && data.header.title) || content.title || content.summary, content.author_name)
    }
    if (!page || !page.paging || page.paging.is_end !== false) break
  }

  const moments = (await get(`/api/v3/moments/${slug}/activities?limit=10&desktop=true`)) || (await get(`/api/v4/members/${slug}/activities?limit=10&desktop=true`))
  for (const activity of (moments && moments.data) || []) {
    const target = activity.target || {}
    if (!/^(赞同了|喜欢了|收藏了)/.test(activity.action_text || activity.verb || '')) continue
    if (target.type === 'answer' || target.type === 'article') add('liked', target.id, named(target), target.author && target.author.name)
  }

  const lists = await get(`/api/v4/members/${slug}/favlists?offset=0&limit=5`)
  for (const list of ((lists && lists.data) || []).slice(0, 2)) {
    const saved = (await get(`/api/v4/collections/${list.id}/items?offset=0&limit=20`)) || (await get(`/api/v4/favlists/${list.id}/items?offset=0&limit=20`))
    for (const row of (saved && saved.data) || []) {
      const content = row.content || row
      add('saved', content.id, named(content), content.author && content.author.name)
    }
  }
  return { account: me.name || slug, items, notes }
}

export async function read({ open, close, inPage, signedIn }) {
  if (!(await signedIn('https://www.zhihu.com', ['z_c0']))) return { problem: 'signed_out' }
  const tab = await open('https://www.zhihu.com/')
  try {
    const found = await inPage(tab, zhihuLists)
    if (!found || found.signedOut) return { problem: 'signed_out', detail: found?.notes.join('; ') }
    const detail = found.notes.join('; ')
    return found.items.length ? { account: found.account, items: found.items, detail } : { problem: 'unreadable', detail }
  } finally {
    await close(tab)
  }
}
