import { browser } from 'wxt/browser'
import { keyHints } from '../../keys'
import { linkAssetUrl } from '../../origins'
import { lastPricesSent } from '../../progress'
import { PROVIDER_IDS } from '../../shared/protocol/types.js'
import { ADAPTERS } from '../../shared/providers/registry.js'
import { getCustomSources } from '../../sources'
import { el, icon } from './dom'

export type StepState = 'done' | 'current' | 'upcoming'

export interface SetupProgress {
  /** Names of the providers with a key and of the user's own sources. */
  ready: string[]
  lastSent: Date | undefined
}

/** Where the user is: the first step not done yet is the current one. */
export function stepStates(progress: SetupProgress): [StepState, StepState, StepState] {
  const done = [progress.ready.length > 0, progress.lastSent !== undefined, progress.lastSent !== undefined]
  const current = done.indexOf(false)
  return done.map((d, i) => (d ? 'done' : i === current ? 'current' : 'upcoming')) as [StepState, StepState, StepState]
}

/** The word by the page title: where the setup stands, at a glance. */
export function setupPill(progress: SetupProgress): { label: string; tone: 'ok' | 'next' | 'none' } {
  if (progress.ready.length > 0 && progress.lastSent) return { label: 'Working', tone: 'ok' }
  if (progress.ready.length > 0) return { label: 'Ready to link', tone: 'next' }
  return { label: 'Not set up yet', tone: 'none' }
}

function formatWhen(date: Date): string {
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** The steps' short names on the track, and each one's own heading when it is the one to do. */
const STEPS = [
  { short: 'Add a key or a source', title: 'Add your provider\u2019s key, or a source of your own' },
  { short: 'Link an asset in Turbobulls', title: 'Link an asset in Turbobulls' },
  { short: 'Prices keep up by themselves', title: 'Leave the rest to Turbobulls' },
] as const

const STATE_LABELS: Record<StepState, string> = { done: 'Done', current: 'Next', upcoming: 'Later' }

/** Jump to a section of the page and put the cursor on its first field or button. */
function jumpTo(id: string): void {
  const section = document.getElementById(id)?.closest('section')
  section?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  section?.querySelector<HTMLElement>('input, button.primary, .list button, button.link, button.add')?.focus({ preventScroll: true })
}

export async function readProgress(): Promise<SetupProgress> {
  const hints = await keyHints()
  const sources = await getCustomSources()
  const ready = [...PROVIDER_IDS.filter((p) => hints[p]).map((p) => ADAPTERS[p].name), ...sources.map((s) => s.name)]
  return { ready, lastSent: await lastPricesSent() }
}

function renderPill(pill: HTMLElement, progress: SetupProgress): void {
  const { label, tone } = setupPill(progress)
  pill.replaceChildren(el('span', { className: `dot ${tone === 'none' ? '' : tone}`.trim() }), label)
}

/** Everything done: one line, with when prices last went to Turbobulls. */
function allSet(card: HTMLElement, lastSent: Date, appUrl: string): void {
  card.className = 'card status-card'
  card.replaceChildren(
    el('span', { className: 'tile' }, icon('check')),
    el(
      'div',
      { className: 'text' },
      el('h2', { id: 'setup-title' }, 'All set'),
      el('p', {}, `Prices last went to Turbobulls on ${formatWhen(lastSent)}. They update while Turbobulls is open in this browser, and reach your phone through sync.`),
    ),
    el('a', { className: 'button sm', href: appUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Link another asset'),
  )
}

export async function renderSteps(card: HTMLElement, pill: HTMLElement): Promise<void> {
  const progress = await readProgress()
  const states = stepStates(progress)
  const appUrl = linkAssetUrl(import.meta.env.MODE)
  renderPill(pill, progress)
  if (states.every((s) => s === 'done') && progress.lastSent) {
    allSet(card, progress.lastSent, appUrl)
    return
  }

  const track = el(
    'ol',
    { className: 'track' },
    ...STEPS.map((step, i) => {
      const state = states[i] ?? 'upcoming'
      const item = el(
        'li',
        { className: state },
        el('span', { className: 'marker' }, state === 'done' ? '' : String(i + 1)),
        step.short,
        el('span', { className: 'visually-hidden' }, ` (${STATE_LABELS[state]})`),
      )
      item.querySelector('.marker')?.setAttribute('aria-hidden', 'true')
      if (state === 'current') item.setAttribute('aria-current', 'step')
      return item
    }),
  )

  // Only the step to do now says what to do, with its buttons.
  const now = states.indexOf('current')
  let body: (Node | string)[]
  if (now === 0) {
    const addKey = el('button', { type: 'button', className: 'primary sm' }, 'Add a key')
    addKey.addEventListener('click', () => jumpTo('keys'))
    const addSource = el('button', { type: 'button', className: 'sm' }, 'Add a source')
    addSource.addEventListener('click', () => jumpTo('custom'))
    body = [
      el('p', {}, 'Paste the API key of the provider you pay for. For prices no provider carries, add any address that answers JSON or CSV.'),
      el('div', { className: 'controls' }, addKey, addSource),
    ]
  } else {
    body = [
      el('p', {}, 'In Turbobulls, add a custom asset, open its Prices tab and choose ', el('strong', {}, 'From a custom data source'), '. Pick the source, then the symbol.'),
      el('div', { className: 'controls' }, el('a', { className: 'button primary sm', href: appUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Open Turbobulls')),
    ]
  }
  const doneCount = states.filter((s) => s === 'done').length
  card.className = 'card'
  card.replaceChildren(
    el('div', { className: 'card-head' }, el('h2', { id: 'setup-title' }, 'Set up in three steps'), el('span', { className: 'desc' }, `${doneCount} of 3 done`)),
    track,
    el('div', { className: 'now' }, el('h3', {}, STEPS[now === -1 ? 0 : now]?.title ?? ''), ...body),
  )
}

/** Re-draw the setup whenever a key, a source or the last-sent time changes, from any tab. */
export function watchSteps(card: HTMLElement, pill: HTMLElement): void {
  browser.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') void renderSteps(card, pill)
  })
}
