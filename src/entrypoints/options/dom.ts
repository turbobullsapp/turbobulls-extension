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
