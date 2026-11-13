const LOAD_TIMEOUT = 30_000

const isPage = (tab) => Boolean(tab && tab.url && !tab.url.startsWith('about:'))

/**
 * Sends the tab to an address and resolves once the page there has loaded. A tab also reports
 * "complete" for the blank page it starts on and for the page it is leaving, so only a load of a
 * real page that was seen to begin counts. A tab that is still loading when it is sent on reports
 * only its new address, not a second "loading".
 */
export function go(tabId, url) {
  return new Promise((resolve, reject) => {
    let moving = false
    let over = false
    const done = (finish) => {
      if (over) return
      over = true
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(heard)
      finish()
    }
    const heard = (id, change, tab) => {
      if (id !== tabId) return
      if (change.status === 'loading' || change.url) moving = true
      if (change.status === 'complete' && moving && isPage(tab)) done(resolve)
    }
    const timer = setTimeout(() => done(() => reject(new Error(`${url} did not load`))), LOAD_TIMEOUT)
    chrome.tabs.onUpdated.addListener(heard)
    chrome.tabs.update(tabId, { url }).catch((error) => done(() => reject(error)))
  })
}

/** Opens a page in a background tab of its own. The tab starts empty, so the wait for the page begins before the page does. */
export async function open(url) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
  try {
    await go(tab.id, url)
  } catch (error) {
    await close(tab.id)
    throw error
  }
  return tab.id
}

export const close = (tabId) => chrome.tabs.remove(tabId).catch(() => {})

/** Runs a self-contained function in the page itself, where the site's own state can be read. */
export async function inPage(tabId, func, args = []) {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args })
  return injection?.result ?? null
}

/** Whether the browser holds one of the cookies a site keeps for a signed-in visitor. Only its presence is looked at. */
export async function signedIn(url, names) {
  for (const name of names) {
    if (await chrome.cookies.get({ url, name })) return true
  }
  return false
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Asks again every half second until there is an answer or the time is up. */
export async function until(ask, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const answer = await ask()
    if (answer || Date.now() > deadline) return answer
    await wait(500)
  }
}
