import { browser } from 'wxt/browser'
import { keyHints } from '../../keys'
import { linkAssetUrl } from '../../origins'
import { lastPricesSent } from '../../progress'
import { PROVIDER_IDS } from '../../shared/protocol/types.js'
import { ADAPTERS } from '../../shared/providers/registry.js'
import { getCustomSources } from '../../sources'
import { el } from './dom'

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

function formatWhen(date: Date): string {
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function step(index: number, state: StepState, title: string, ...body: (Node | string)[]): HTMLElement {
  const marker = el('span', { className: 'marker' }, state === 'done' ? '' : String(index))
  marker.setAttribute('aria-hidden', 'true')
  const label = state === 'done' ? 'Done' : state === 'current' ? 'Next' : 'Later'
  return el(
    'li',
    { className: `step ${state}` },
    marker,
    el('div', {}, el('h3', {}, title, el('span', { className: 'visually-hidden' }, ` (${label})`)), ...body),
  )
}

/** Jump to a section of the page and put the cursor in its first field. */
function jumpTo(id: string): void {
  const section = document.getElementById(id)?.closest('section')
  section?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  section?.querySelector<HTMLElement>('input, button.primary')?.focus({ preventScroll: true })
}

export async function readProgress(): Promise<SetupProgress> {
  const hints = await keyHints()
  const sources = await getCustomSources()
  const ready = [...PROVIDER_IDS.filter((p) => hints[p]).map((p) => ADAPTERS[p].name), ...sources.map((s) => s.name)]
  return { ready, lastSent: await lastPricesSent() }
}

export async function renderSteps(list: HTMLElement, progressLabel: HTMLElement): Promise<void> {
  const progress = await readProgress()
  const [one, two, three] = stepStates(progress)
  const appUrl = linkAssetUrl(import.meta.env.MODE)

  const addKey = el('button', { type: 'button', className: one === 'current' ? 'primary' : '' }, 'Add a key')
  addKey.addEventListener('click', () => jumpTo('keys'))
  const addSource = el('button', { type: 'button' }, 'Add a source')
  addSource.addEventListener('click', () => jumpTo('custom'))

  const open = el('a', { className: `button ${two === 'current' ? 'primary' : ''}`.trim(), href: appUrl, target: '_blank', rel: 'noopener noreferrer' }, two === 'done' ? 'Link another asset' : 'Open Turbobulls')

  list.replaceChildren(
    step(
      1,
      one,
      'Add your provider\u2019s key, or a source of your own',
      one === 'done'
        ? el('p', {}, `Ready: ${progress.ready.join(', ')}.`)
        : el('p', {}, 'Paste the API key of the provider you pay for. For prices no provider carries, add any address that answers JSON or CSV.'),
      ...(one === 'done' ? [] : [el('div', { className: 'controls' }, addKey, addSource)]),
    ),
    step(
      2,
      two,
      'Link an asset in Turbobulls',
      el(
        'p',
        {},
        'In Turbobulls, add a custom asset, open its Prices tab and choose ',
        el('strong', {}, 'From my data provider'),
        '. Pick the provider, then the symbol.',
      ),
      ...(one === 'done' ? [el('div', { className: 'controls' }, open)] : []),
    ),
    step(
      3,
      three,
      'Leave the rest to Turbobulls',
      el(
        'p',
        {},
        three === 'done' && progress.lastSent
          ? `Working: prices last went to Turbobulls on ${formatWhen(progress.lastSent)}. They update while Turbobulls is open in this browser, and reach your phone through sync.`
          : 'Prices update by themselves while Turbobulls is open in this browser, and reach your other devices, your phone included, through sync.',
      ),
    ),
  )
  const doneCount = [one, two, three].filter((s) => s === 'done').length
  progressLabel.textContent = doneCount === 3 ? 'All set' : `${doneCount} of 3 done`
}

/** Re-draw the steps whenever a key, a source or the last-sent time changes, from any tab. */
export function watchSteps(list: HTMLElement, progressLabel: HTMLElement): void {
  browser.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') void renderSteps(list, progressLabel)
  })
}
