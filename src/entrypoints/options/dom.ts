/** Small DOM helpers. Text always goes in as text, never as HTML. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  node.append(...children)
  return node
}

export function setStatus(node: HTMLElement, text: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
  node.textContent = text
  node.className = `status ${kind === 'info' ? '' : kind}`.trim()
}

let fieldCount = 0

/** A labelled field: the label is tied to the control for screen readers. */
export function field(label: string, control: HTMLInputElement | HTMLSelectElement, hint?: string): HTMLElement {
  control.id = control.id || `field-${++fieldCount}`
  const wrapper = el('div', { className: 'field' }, el('label', { htmlFor: control.id }, label), control)
  if (hint) wrapper.append(el('p', { className: 'hint' }, hint))
  return wrapper
}

export function select(options: readonly (readonly [value: string, label: string])[], value?: string): HTMLSelectElement {
  const node = el('select')
  for (const [v, label] of options) node.append(el('option', { value: v }, label))
  if (value !== undefined) node.value = value
  return node
}

export function input(props: Partial<HTMLInputElement> = {}): HTMLInputElement {
  return el('input', { type: 'text', autocomplete: 'off', spellcheck: false, ...props })
}

const SVG = 'http://www.w3.org/2000/svg'

/** The page's few icons, drawn as shapes rather than parsed from markup. */
const ICONS = {
  more: [
    ['circle', { cx: '5', cy: '12', r: '1.6', fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: '12', cy: '12', r: '1.6', fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: '19', cy: '12', r: '1.6', fill: 'currentColor', stroke: 'none' }],
  ],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
} as const satisfies Record<string, readonly (readonly [string, Record<string, string>])[]>

export function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
    svg.setAttribute(k, v)
  }
  for (const [tag, attrs] of ICONS[name]) {
    const shape = document.createElementNS(SVG, tag)
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v)
    svg.append(shape)
  }
  return svg
}

export interface MenuItem {
  label: string
  /** Opens this address in a new tab, in place of an action. */
  href?: string
  onSelect?: () => void
  danger?: boolean
}

let menuCount = 0

/**
 * A row's ⋯ menu: a button that opens a short list of actions. Arrow keys move between them,
 * Escape or a click elsewhere closes it, and focus goes back to the button.
 */
export function rowMenu(label: string, items: MenuItem[]): HTMLElement {
  const id = `menu-${++menuCount}`
  const button = el('button', { type: 'button', className: 'icon', title: 'More' }, icon('more'))
  button.setAttribute('aria-label', label)
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-controls', id)
  const menu = el('div', { id, className: 'menu', hidden: true })
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', label)
  const wrap = el('span', { className: 'menu-wrap' }, button, menu)

  const entries = items.map((item) => {
    const entry = item.href
      ? el('a', { href: item.href, target: '_blank', rel: 'noopener noreferrer' }, item.label)
      : el('button', { type: 'button' }, item.label)
    entry.setAttribute('role', 'menuitem')
    entry.tabIndex = -1
    if (item.danger) entry.classList.add('danger')
    entry.addEventListener('click', () => {
      close(true)
      item.onSelect?.()
    })
    menu.append(entry)
    return entry
  })

  const onOutside = (event: PointerEvent) => {
    if (!wrap.contains(event.target as Node)) close(false)
  }
  function open() {
    menu.hidden = false
    button.setAttribute('aria-expanded', 'true')
    document.addEventListener('pointerdown', onOutside)
    entries[0]?.focus()
  }
  function close(refocus: boolean) {
    if (menu.hidden) return
    menu.hidden = true
    button.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', onOutside)
    if (refocus) button.focus()
  }

  button.addEventListener('click', () => (menu.hidden ? open() : close(true)))
  menu.addEventListener('keydown', (event) => {
    const at = entries.indexOf(document.activeElement as HTMLButtonElement | HTMLAnchorElement)
    const move = (to: number) => {
      event.preventDefault()
      entries[(to + entries.length) % entries.length]?.focus()
    }
    if (event.key === 'ArrowDown') move(at + 1)
    else if (event.key === 'ArrowUp') move(at - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(entries.length - 1)
    else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') close(false)
  })
  return wrap
}
