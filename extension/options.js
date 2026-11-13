const t = (name, value) => chrome.i18n.getMessage(name, value === undefined ? undefined : [String(value)])
const $ = (id) => document.getElementById(id)

for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n)
document.documentElement.lang = chrome.i18n.getUILanguage()

async function ask(message) {
  const answer = await chrome.runtime.sendMessage(message)
  if (!answer?.ok) throw new Error(answer?.error ?? '')
  return answer.result
}

const KINDS = ['watched', 'liked', 'saved', 'followed']
let reading = null

function show({ paired, sites, known }) {
  $('paired').textContent = paired ? t('pairedAs', paired.username) : t('notPaired')
  $('unpair').hidden = !paired
  if (paired) $('address').value = paired.url

  $('sites').replaceChildren(
    ...known.map((id) => {
      const state = sites[id] ?? {}
      const row = document.createElement('li')
      const name = document.createElement('strong')
      name.textContent = t(id) || id
      const button = document.createElement('button')
      button.textContent = reading === id ? t('reading') : t('readNow')
      button.disabled = !paired || reading !== null
      button.addEventListener('click', () => void read(id))
      const detail = document.createElement('span')
      detail.className = 'muted'
      const counts = KINDS.flatMap((kind) => (state.counts?.[kind] ? [t(kind, state.counts[kind])] : []))
      detail.textContent = state.readAt ? [t('readOn', new Date(state.readAt).toLocaleDateString()), ...counts].join(', ') : t('never')
      row.append(name, button, detail)
      if (state.problem) {
        // Not being signed in to a site is ordinary; anything else is worth noticing.
        const problem = document.createElement('span')
        problem.className = state.problem === 'signed_out' ? 'muted wide' : 'error'
        problem.textContent = t(`problem_${state.problem}`)
        row.append(problem)
      }
      if (state.detail) {
        const detail = document.createElement('small')
        detail.className = 'wide'
        detail.textContent = state.detail
        row.append(detail)
      }
      return row
    }),
  )
}

async function read(site) {
  reading = site
  show(await ask({ type: 'state' }))
  try {
    const state = await ask({ type: 'read', site })
    reading = null
    show(state)
  } catch {
    reading = null
    show(await ask({ type: 'state' }))
  }
}

$('pairing').addEventListener('submit', async (event) => {
  event.preventDefault()
  $('notice').textContent = ''
  let origin
  try {
    origin = new URL($('address').value.trim()).origin
  } catch {
    $('notice').textContent = t('pairFailed', $('address').value)
    return
  }
  // Chrome only grants a new host from inside the click that asked for it.
  if (!(await chrome.permissions.request({ origins: [`${origin}/*`] }))) {
    $('notice').textContent = t('permissionNeeded')
    return
  }
  try {
    show(await ask({ type: 'pair', address: origin, key: $('key').value.trim() }))
    $('key').value = ''
  } catch (error) {
    $('notice').textContent = t('pairFailed', error.message)
  }
})

$('unpair').addEventListener('click', async () => show(await ask({ type: 'unpair' })))

show(await ask({ type: 'state' }))
