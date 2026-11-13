import { call, pair, pairing, setSiteState, siteStates, unpair } from './pulse.js'
import { SITES } from './sites/index.js'
import * as tabs from './tabs.js'

const HOUR = 60 * 60 * 1000
const READ_EVERY = 72 * HOUR
const RETRY_AFTER = 24 * HOUR

const lang = () => (chrome.i18n.getUILanguage().startsWith('zh') ? 'zh' : 'en')

/** Reads one site in a background tab and sends what it finds to Pulse; what happened is kept for the options page. */
async function readSite(id) {
  let state
  try {
    const found = await SITES[id].read(tabs)
    if (found.problem) {
      state = { problem: found.problem, detail: found.detail }
    } else {
      await call('/api/extension/activity', { platform: id, account: found.account, items: found.items, lang: lang() })
      const counts = {}
      for (const item of found.items) counts[item.kind] = (counts[item.kind] ?? 0) + 1
      state = { readAt: Date.now(), counts, detail: found.detail }
    }
  } catch (error) {
    state = { problem: error.code === 'key_rejected' ? 'unpaired' : 'failed', detail: String(error?.message ?? error) }
  }
  const before = (await siteStates())[id] ?? {}
  await setSiteState(id, { readAt: before.readAt, counts: before.counts, ...state, problem: state.problem ?? null, detail: state.detail ?? null, triedAt: Date.now() })
}

/** One read at a time: each opens a tab, and two would get in each other's way. */
let queue = Promise.resolve()
const inTurn = (work) => (queue = queue.then(work, work))

async function readDue() {
  if (!(await pairing())) return
  const states = await siteStates()
  for (const id of Object.keys(SITES)) {
    const { readAt = 0, triedAt = 0 } = states[id] ?? {}
    if (Date.now() - readAt < READ_EVERY || Date.now() - triedAt < RETRY_AFTER) continue
    await readSite(id)
    await tabs.wait(5000)
  }
}

const schedule = () => chrome.alarms.create('read', { delayInMinutes: 5, periodInMinutes: 360 })
chrome.runtime.onInstalled.addListener(schedule)
chrome.runtime.onStartup.addListener(schedule)
chrome.alarms.onAlarm.addListener(() => inTurn(readDue))
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage())

const state = async () => {
  const paired = await pairing()
  return { paired: paired && { url: paired.url, username: paired.username }, sites: await siteStates(), known: Object.keys(SITES) }
}

const ASKED = {
  state,
  pair: async ({ address, key }) => {
    await pair(address, key)
    return state()
  },
  unpair: async () => {
    await unpair()
    return state()
  },
  read: async ({ site }) => {
    if (SITES[site]) await inTurn(() => readSite(site))
    return state()
  },
}

// The options page asks for everything through here, so every request to Pulse leaves from the background.
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  const answer = ASKED[message?.type]
  if (!answer) return false
  answer(message).then(
    (result) => reply({ ok: true, result }),
    (error) => reply({ ok: false, error: String(error?.message ?? error) }),
  )
  return true
})
