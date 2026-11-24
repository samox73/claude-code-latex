import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { tex2svg } from '../hooks/mathjax/mathjax-entry.js'
import { rasterize, viewBox } from '../hooks/raster'
import { cite, split } from '../hooks/register'

// What a terminal session gives the mod beneath it: its environment, and a
// config list (where it reads the theme; none here, so the dark default).
function terminal(on: On, env: Record<string, string>) {
  mock.env(on, env)
  on('config.list', () => ({ value: [] }))
}

test('display math is cut out; fenced code and inline $ are left alone', () => {
  const text = 'Before $x$\n$$\\frac{a}{b}$$\nmid \\[ \\Sigma \\]\n```\n$$not math$$\n```\nafter'
  expect(split(text)).toEqual([
    { md: 'Before $x$\n' },
    { tex: '\\frac{a}{b}' },
    { md: '\nmid ' },
    { tex: '\\Sigma' },
    { md: '\n```\n$$not math$$\n```\nafter' },
  ])
  expect(split('An unfinished `$$` stays.\n\n$$x$$')).toEqual([{ md: 'An unfinished `$$` stays.\n\n' }, { tex: 'x' }])
  expect(split('cost $$5\n\nand $$6')).toEqual([{ md: 'cost $$5\n\nand $$6' }])
  expect(split('a\n\\begin{align*}x &= 1\\end{align*}\nb')).toEqual([{ md: 'a\n' }, { tex: '\\begin{align*}x &= 1\\end{align*}' }, { md: '\nb' }])
  expect(split('a\n```\ncode\n```\nb\n$$x$$\nc')).toEqual([{ md: 'a\n```\ncode\n```\nb\n' }, { tex: 'x' }, { md: '\nc' }])
  expect(split('streaming $$\\frac{1}{')).toEqual([{ md: 'streaming $$\\frac{1}{' }])
})

test('an assistant reply with $$ draws an Image; a TeX error falls back to source', async ($, on) => {
  terminal(on, { TERM: 'xterm-kitty' })
  const props = { text: 'Energy:\n$$E = \\hbar \\omega$$\nbad: $$\\frac{$$', isFirstOfReply: true }
  const ui = await $.ui.mount({ plugin: 'tex-display', surface: 'terminal', component: 'AssistantMessage', props })
  const img = await ui.find({ type: 'Image' })
  expect(img?.props.alt).toBe('E = \\hbar \\omega')
  expect(await ui.find({ type: 'Markdown', text: /```latex/ })).toBeDefined()
  await ui.unmount()
})

test('many big equations in one reply stay under the per-message Image budget', async ($, on) => {
  terminal(on, { TERM: 'xterm-ghostty' })
  const eq = '$$\\Sigma(\\omega) = \\frac{1}{N_q}\\sum_{\\mathbf q\\nu m} |g_{mn\\nu}(\\mathbf k,\\mathbf q)|^2 \\left[\\frac{n+1-f}{\\omega-\\varepsilon-\\omega_{\\mathbf q\\nu}+i\\eta}+\\frac{n+f}{\\omega-\\varepsilon+\\omega_{\\mathbf q\\nu}+i\\eta}\\right]$$'
  const text = Array.from({ length: 8 }, (_, i) => `${i}.\n${eq}`).join('\n')
  const ui = await $.ui.mount({ plugin: 'tex-display', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  const img = await ui.find({ type: 'Image' })
  expect(String((img?.props.source as { png: string }).png).slice(0, 8)).toBe('iVBORw0K') // PNG signature, base64
  expect(await ui.find({ type: 'Markdown', text: /```latex/ })).toBeUndefined() // none fell back for size
  await ui.unmount()
})

test('the math instruction rides along once per context window', async ($, on) => {
  const seen: (readonly string[] | undefined)[] = []
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('prompt.submit', ($, e) => { seen.push(e.context); return { text: e.text, context: e.context } })
  for (const text of ['a', 'b']) await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  expect(seen[0]?.some(c => c.startsWith('# Math rendering'))).toBe(true)
  expect(seen[1]?.some(c => c.startsWith('# Math rendering')) ?? false).toBe(false)
})

test('stretchy braces: the clipped, stretched middle pieces land under the content', () => {
  // letters without descenders, so the lower half of the image is the brace alone
  const svg = tex2svg('\\underbrace{acemnorsuvwxz}')
  const [, , w, h] = viewBox(svg), W = Math.ceil((w / 1000) * 40), H = Math.ceil((h / 1000) * 40)
  const a = rasterize(svg, { width: W, height: H, pxPerEm: 40, dx: 0, dy: 0 })
  const bare: number[] = [] // columns the brace never inks
  for (let x = Math.floor(W * 0.05); x < Math.ceil(W * 0.95); x++) {
    let ink = false
    for (let y = Math.floor(H / 2); y < H; y++) ink ||= a[y * W + x] > 128
    if (!ink) bare.push(x)
  }
  expect(bare).toEqual([])
})

test('\\boxed draws a frame, not a filled box', () => {
  const svg = tex2svg('\\boxed{\\qquad}')
  const [, , w, h] = viewBox(svg), W = Math.ceil((w / 1000) * 40), H = Math.ceil((h / 1000) * 40)
  const a = rasterize(svg, { width: W, height: H, pxPerEm: 40, dx: 0, dy: 0 })
  const mid = Math.floor(H / 2) * W
  expect(a[mid + Math.floor(W / 2)]).toBe(0) // empty inside
  expect(Math.max(...a.subarray(mid, mid + 6))).toBeGreaterThan(200) // left edge inked
})

const PLAIN: [string, Record<string, string>][] = [
  ['a terminal without kitty graphics', { TERM: 'xterm-256color' }],
  ['tmux, even inside kitty', { TERM: 'xterm-kitty', TMUX: '/tmp/tmux-1000/default,1,0' }],
]
for (const [name, env] of PLAIN)
  test(`${name} gets Unicode text instead of images`, async ($, on) => {
    terminal(on, env)
    const props = { text: 'Energy:\n$$E = \\hbar \\omega$$', isFirstOfReply: true }
    const ui = await $.ui.mount({ plugin: 'tex-display', surface: 'terminal', component: 'AssistantMessage', props })
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'E = ℏω' })).toBeDefined()
    await ui.unmount()
  })

test('/tex-calibrate: the probe box, and "Blue above/below" raises the trial aspect', async ($, on) => {
  terminal(on, { TERM: 'xterm-kitty' })
  const props = { title: 'Calibrate math', isFocused: true, bodyColumns: 80, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 12 }, view: {} }
  const ui = await $.ui.mount({ plugin: 'tex-display', surface: 'terminal', component: 'Pane', requestId: 'tex-calibrate', props })
  expect(await ui.find({ type: 'Image', key: 'probe' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cellAspect 2\.15 \(current\)/ })).toBeDefined()
  await ui.press({ key: 'below' })
  expect(await ui.find({ type: 'Text', text: /cellAspect 2\.16 \(current 2\.15\)/ })).toBeDefined()
  await ui.unmount()
})

test('/btw is answered by a fork of the transcript; its output row draws the math', async ($, on) => {
  terminal(on, { TERM: 'xterm-kitty' })
  const text = 'Energy:\n$$E = \\hbar \\omega$$'
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('model.fork', ($, e) => ({ value: { isAnswered: true as const, text: e.prompt.endsWith('\n\nwhat is E?') ? text : `lost the question: ${e.prompt}`, usage } }))
  const run = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 80 } }
  expect((await $.command.run({ ...run, command: 'btw', args: 'what is E?' })).text).toBe(text)
  const props = { command: 'btw', args: 'what is E?', text, isErrored: false }
  const ui = await $.ui.mount({ plugin: 'tex-display', surface: 'terminal', component: 'CommandOutput', props })
  expect((await ui.find({ type: 'Image' }))?.props.alt).toBe('E = \\hbar \\omega')
  await ui.unmount()
})

test('equations are numbered X.Y, the model is told the next number, and a cited one carries its source', async ($, on) => {
  terminal(on, { TERM: 'xterm-256color' })
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  const seen: string[][] = []
  on('prompt.submit', ($, e) => { seen.push((e.context ?? []).filter(c => !c.startsWith('# Math rendering'))); return { text: e.text, context: e.context } })
  const prompt = (text: string, kind: 'composer' | 'task-notification' = 'composer') => $.prompt.submit({ text, wait: false, origin: { kind } })
  const row = (uuid: string, text: string, extra: { door?: 'command'; agentId?: string } = {}) =>
    $.session.append({
      door: extra.door ?? 'response', uuid, agentId: extra.agentId,
      origin: extra.door ? { kind: 'composer' } : { kind: 'model', model: 'm' },
      message: extra.door ? { type: 'system', name: 'local_command', content: [{ type: 'text', text }] } : { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    })
  const labels = async (requestId: string, text: string) => {
    const ui = await $.ui.mount({ plugin: 'tex-display', surface: 'terminal', component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: true } })
    const all = ['(2.1)', '(2.2)', '(2.3)', '(2.4)', '(2.b1)']
    const found = await Promise.all(all.map(async l => ((await ui.find({ type: 'Text', text: l })) ? l : '')))
    await ui.unmount()
    return found.filter(Boolean)
  }

  await prompt('one')
  await row('a1', 'no math here')
  await prompt('two')
  await row('a2', '$$a$$\nand\n$$b$$')
  await row('sub', '$$never drawn$$', { agentId: 'agent-1' })
  await row('echo', '<command-name>/btw</command-name> about $$q$$', { door: 'command' })
  await row('side', '<local-command-stdout>tex-display: $$s$$</local-command-stdout>', { door: 'command' })
  await row('a3', 'after a tool call:\n$$c$$')
  await prompt('a task finished', 'task-notification')
  await row('a4', '$$d$$')
  await prompt('why the sign in (2.3) and (2.b1), and 1.5 eV in (9.9)?')

  expect(await labels('a2', '$$a$$\nand\n$$b$$')).toEqual(['(2.1)', '(2.2)'])
  expect(await labels('a3', 'after a tool call:\n$$c$$')).toEqual(['(2.3)']) // the /btw answer took no Y
  expect(await labels('side', '$$s$$')).toEqual(['(2.b1)'])
  expect(await labels('a4', '$$d$$')).toEqual(['(2.4)']) // a notification opens no new X
  expect(await labels('unknown', '$$x$$')).toEqual([]) // a row never counted draws unnumbered
  expect(seen.map(c => c[0])).toEqual([
    'Display equations you write from here on are drawn numbered (1.1), (1.2), … in order.',
    'Display equations you write from here on are drawn numbered (2.1), (2.2), … in order.',
    'Display equations you write from here on are drawn numbered (2.4), (2.5), … in order.',
    'Display equations you write from here on are drawn numbered (3.1), (3.2), … in order.',
  ])
  expect(seen[3][1]).toBe('The user cites equations by the numbers this terminal draws beside them. Their LaTeX source:\n(2.3): c\n(2.b1): s')
})

test('cite: the forms a prompt names an equation by; unknown numbers and bare decimals are left alone', () => {
  const n = { x: 3, y: 2, at: {}, tex: { '3.1': 'a', '3.2': 'b', '1.5': 'c' } }
  expect(cite('see (3.2), Eq. 3.1, eqs. (3.2) and equation 3.1', n)).toBe('The user cites equations by the numbers this terminal draws beside them. Their LaTeX source:\n(3.2): b\n(3.1): a')
  expect(cite('a gap of 1.5 eV, version 3.2, and (7.7)', n)).toBe('')
  expect(cite('(3.2)', { x: 0, y: 0, at: {} })).toBe('') // a store from before the sources were kept
})
