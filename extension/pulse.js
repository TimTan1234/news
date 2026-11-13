/** Where the reader's Pulse is and the key it accepts, as `{ url, key, username }`. */
export const pairing = async () => (await chrome.storage.local.get('pairing')).pairing ?? null

/** What happened the last time each site was read. */
export const siteStates = async () => (await chrome.storage.local.get('sites')).sites ?? {}

export async function setSiteState(id, state) {
  await chrome.storage.local.set({ sites: { ...(await siteStates()), [id]: state } })
}

async function request({ url, key }, path, body) {
  const res = await fetch(url + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `HTTP ${res.status}`), { code: data?.code })
  return data
}

export async function call(path, body) {
  const paired = await pairing()
  if (!paired) throw Object.assign(new Error('Not paired'), { code: 'key_rejected' })
  return request(paired, path, body)
}

/** Keeps the address and key once the Pulse at that address has accepted them. */
export async function pair(address, key) {
  const url = new URL(address).origin
  const { username } = await request({ url, key }, '/api/extension/status')
  await chrome.storage.local.set({ pairing: { url, key, username } })
  return username
}

export const unpair = () => chrome.storage.local.remove(['pairing', 'sites'])
