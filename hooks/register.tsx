import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import { tex2svg } from './mathjax/mathjax-entry.js'
import { encodePng } from './png'
import { rasterize, viewBox } from './raster'
import { texToUnicode } from './vendor/latex-inline/unicode'

// Rendered pixels per terminal cell. The terminal scales a picture to fit its
// cell box keeping its aspect, so a picture drawn for the wrong cell aspect is
// never distorted, only drawn smaller with an empty band beside or below it;
// `cellAspect` (the plugin can't read pixel sizes, its processes have no tty;
// /tex-calibrate sets it) makes it fill the box. The absolute size only sets
// the sharpness.
const CELL_W = 20
const MAX_BYTES = 2 * 1024 * 1024 // Image source limit, for all Images of one drawn message together
const LABEL_W = 9 // columns kept free right of an equation for its number: "(12.34)" and a gap

// Fenced code passes through untouched; outside it, $$…$$, \[…\] and bare
// \begin{equation|align|gather|multline}…\end{…} (starred too) are display math.
// Inline code spans are matched too, only to be skipped, and no match crosses a
// blank line (TeX forbids one in math), so a stray `$$` can't swallow a paragraph.
const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm
const DISPLAY = /(`+)(?:(?!\n\s*\n)[\s\S])*?\1|\$\$((?:(?!\n\s*\n)[\s\S])+?)\$\$|\\\[((?:(?!\n\s*\n)[\s\S])+?)\\\]|(\\begin\{(equation|align|gather|multline)(\*?)\}(?:(?!\n\s*\n)[\s\S])+?\\end\{\5\6\})/g

export type Piece = { md: string } | { tex: string }

export function split(text: string): Piece[] {
  const out: Piece[] = []
  let md = '' // markdown since the last math, fences included: one Markdown element keeps its spacing
  const flush = () => { if (md.trim()) out.push({ md }); md = '' }
  let at = 0
  for (const f of text.matchAll(FENCE)) {
    const rest = math(text.slice(at, f.index), flush, out) // not `md += math(…)`: that reads md before math flushes it
    md += rest + f[0]
    at = f.index + f[0].length
  }
  const rest = math(text.slice(at), flush, out)
  md += rest
  flush()
  return out

  // Moves each display block of `s` into `out`, flushing the markdown before it;
  // returns the markdown after the last one.
  function math(s: string, flush: () => void, out: Piece[]) {
    let at = 0
    for (const m of s.matchAll(DISPLAY)) {
      if (m[1]) continue // a code span: stays in the markdown
      md += s.slice(at, m.index)
      flush()
      out.push({ tex: (m[2] ?? m[3] ?? m[4]).trim() })
      at = m.index + m[0].length
    }
    return s.slice(at)
  }
}

const MATH_PROMPT = `# Math rendering
This terminal renders display math. When an equation should be shown (not handed over as LaTeX source to copy), write it as display math on its own lines, outside any code fence: $$ … $$ (or \\[ … \\], or a bare \\begin{equation|align|gather|multline} environment). Backslashes inside these blocks reach the renderer unchanged, so any TeX spacing or escape works there. Never write inline math: no $ … $, \\( … \\), or LaTeX commands inside prose, since they show as raw source. Any formula, even a short one, goes in its own display block. In running text, name a single symbol or index in plain Unicode (τ, Σ, ω_q, N_q) and put anything with structure (fractions, sums, sub/superscript combinations, operators) in a display block after the sentence.

Each display block is drawn with a number (X.Y) at its right: X counts the user's prompts, Y the display blocks you wrote since prompt X, in order and across tool calls (a block inside a code fence is not drawn, so not counted). A note with each prompt gives the next number. The user refers to equations by these numbers; refer to them the same way, as "(3.2)" in prose, and never write a number or \\tag inside a block yourself.`

// Who a new X is opened for: the person's own prompts. Any other submission
// (a task's notification, another session's message) continues the Ys.
const PERSON = ['composer', 'bridge', 'sdk']

// What the built-in /btw tells the model, in short: a fork denies every tool.
const BTW_NOTE = 'A side question, answered apart from the main conversation: reply directly in one message from what you already know. No tools run here, so never promise to check or look something up.'

type Picture = { png: string; bytes: number; columns: number; rows: number }

// ponytail: unbounded until 500 entries then cleared; an LRU if that ever churns.
const cache = new Map<string, Picture | null>()

function picture(tex: string, maxColumns: number, rgb: [number, number, number], cellH: number, scale: number): Picture | null {
  const id = `${maxColumns}|${rgb}|${cellH}|${scale}|${tex}`
  if (cache.has(id)) return cache.get(id)!
  if (cache.size > 500) cache.clear()
  let pic: Picture | null = null
  try {
    const svg = tex2svg(tex)
    const [, , w, h] = viewBox(svg)
    // one em = `scale` rows; shrink only if too wide, round the box up to whole
    // cells, then lower the pixel density to fit the byte limit
    const em = cellH * scale
    const fit = Math.min(1, (maxColumns * CELL_W) / ((w / 1000) * em))
    const columns = Math.max(1, Math.ceil(((w / 1000) * em * fit) / CELL_W))
    const rows = Math.max(1, Math.ceil(((h / 1000) * em * fit) / cellH))
    const k = Math.min(1, 4096 / (columns * CELL_W))
    const width = Math.floor(columns * CELL_W * k), height = Math.floor(rows * cellH * k)
    const pxPerEm = em * fit * k
    const dy = (height - (h / 1000) * pxPerEm) / 2 // centre vertically in the cell rows
    const png = encodePng(rasterize(svg, { width, height, pxPerEm, dx: 0, dy }), width, height, rgb)
    pic = { png: (png as Uint8Array & { toBase64(): string }).toBase64(), bytes: png.length, columns: Math.min(columns, 255), rows: Math.min(rows, 255) }
  } catch {
    pic = null // TeX error or unsupported construct: shown as source instead
  }
  cache.set(id, pic)
  return pic
}

// Equation numbers "(X.Y)": X counts the person's prompts, Y the display blocks
// the model wrote since prompt X. X moves in prompt.submit, where the model is
// told the next number in the same breath, so what it was told is what is drawn;
// Ys are assigned as rows are stored (session.append, whose uuid is the
// requestId the row is drawn under). A /btw answer, which the model never sees,
// is numbered apart, "(X.bN)", so it can't shift the Ys the model counts. All of
// it is kept in $.store under the session's id, so a hot reload or a --resume
// draws the same numbers.
// `at`: a drawn row's X, the count before its first block, and 1 on a /btw row.
// `tex`: each numbered block's source under its "X.Y" or "X.bN", for cite() below.
export type Numbers = { x: number; y: number; b?: number; at: Record<string, [number, number, 1?]>; tex?: Record<string, string> }
type Held = { key: string; n: Numbers }

// The equations a prompt cites by number, as a note for the model, which has
// to count to resolve one and has lost the block itself after a compaction:
// "(3.2)", "eq. 3.2", "Eqs. (3.2)", "equation 3.2", "(3.b1)". Only
// numbers that were drawn count, so "(1.5)" meaning something else is left
// alone unless an equation 1.5 exists. '' when the prompt cites none.
// ponytail: a bare list ("eqs. 3.2 and 3.3") resolves its first number only; parenthesised ones all resolve.
const CITED = /\((\d+\.b?\d+)\)|\b(?:eqs?\.?|equations?)\s*\(?(\d+\.b?\d+)/gi

export function cite(text: string, n: Numbers): string {
  const ids = new Set([...text.matchAll(CITED)].map(m => m[1] ?? m[2]).filter(id => n.tex?.[id] !== undefined))
  if (!ids.size) return ''
  return 'The user cites equations by the numbers this terminal draws beside them. Their LaTeX source:\n' + [...ids].map(id => `(${id}): ${n.tex![id]}`).join('\n')
}
const KEPT_SESSIONS = 50

async function numbersOf($: EngineInterface): Promise<Held> {
  const fresh = (): Numbers => ({ x: 0, y: 0, at: {} })
  try {
    const key = `numbers:${await $.session.id()}`
    const n = (await $.store.get(key)) as Numbers | undefined
    if (n) return { key, n }
    // ponytail: drops the oldest-created sessions, not the least recently used; an LRU if resumed old sessions lose their numbers.
    const old = (await $.store.keys()).filter(k => k.startsWith('numbers:'))
    for (const k of old.slice(0, Math.max(0, old.length + 1 - KEPT_SESSIONS))) await $.store.delete(k)
    return { key, n: fresh() }
  } catch {
    return { key: 'numbers:unknown', n: fresh() } // no store: the math is still drawn, numbered for this run only
  }
}

// What the terminal can show: images where it speaks the kitty graphics protocol
// (kitty, Ghostty; tmux passes none of it through), Unicode text elsewhere; and
// the ink colour, from Claude Code's theme or, for "auto", the terminal's COLORFGBG.
type Look = { images: boolean; rgb: [number, number, number] }

async function detect($: EngineInterface): Promise<Look> {
  const [term, program, kitty, tmux, fgbg] = await Promise.all([
    $.env.get('TERM'), $.env.get('TERM_PROGRAM'), $.env.get('KITTY_WINDOW_ID'), $.env.get('TMUX'), $.env.get('COLORFGBG'),
  ])
  const images = !tmux && (term?.includes('kitty') || term === 'xterm-ghostty' || program === 'ghostty' || !!kitty)
  const theme = String((await $.config.list()).find(r => r.key === 'theme')?.value ?? '')
  const background = fgbg?.split(';').at(-1)
  const light = theme === 'auto' ? background === '7' || background === '15' : theme.startsWith('light')
  return { images: !!images, rgb: light ? [20, 20, 20] : [224, 224, 224] }
}

// /tex-calibrate: a solid picture drawn for a trial cell aspect, on a blue box
// exactly its size in cells. The terminal fits the picture into the box keeping
// its aspect, so blue shows beside it when the trial is too high and above or
// below it when too low; nudged until no blue shows, it's saved as cellAspect.
const CALIBRATE = 'tex-calibrate'
const trial = atom({ plugin: 'tex-display', key: 'aspect' } as const, 0)
const PROBE_ROWS = 6, PROBE_COLUMNS = 14

function probe(a: number, rgb: [number, number, number]) {
  const width = PROBE_COLUMNS * CELL_W, height = Math.round(PROBE_ROWS * CELL_W * a)
  const png = encodePng(new Uint8Array(width * height).fill(255), width, height, rgb) as Uint8Array & { toBase64(): string }
  return png.toBase64()
}

// The display math of a transcript row's text as images (Unicode text where
// the terminal can't show them) between its markdown, in a column that
// replaces the row's text; null when the text has none, so the engine's own
// row stands. (Top level: the sandbox passes `$` to such functions only.)
function column($: EngineInterface, e: RenderInput<'AssistantMessage' | 'CommandOutput', 'terminal'>, text: string, { images, rgb }: Look, cellH: number, scale: number, { n }: Held) {
  if (!/\$\$|\\\[|\\begin\{/.test(text)) return null
  const pieces = split(text)
  if (!pieces.some(p => 'tex' in p)) return null
  const { Box, Text, Markdown, Image } = $.ui.resolve(e)
  const maxColumns = Math.max(10, (e.viewport?.columns ?? 80) - 6 - LABEL_W)
  let budget = MAX_BYTES
  const at = n.at[e.requestId] // absent on a row stored before the mod counted: drawn unnumbered
  let y = 0
  return (
    <Box flexDirection="column" flexGrow={1}>
      {pieces.map((p, i) => {
        if ('md' in p) return <Markdown key={`m${i}`} text={p.md} />
        let body
        if (!images) body = <Box paddingLeft={2}><Text>{texToUnicode(p.tex)}</Text></Box>
        else {
          const pic = picture(p.tex, maxColumns, rgb, cellH, scale)
          if (pic) budget -= pic.bytes
          body = !pic || budget < 0
            ? <Markdown key={`m${i}`} text={'```latex\n' + p.tex + '\n```'} />
            : (
              <Box paddingLeft={2}>
                <Image key={`t${i}`} source={{ png: pic.png }} columns={pic.columns} rows={pic.rows} alt={p.tex.replace(/\s+/g, ' ')} />
              </Box>
            )
        }
        return (
          <Box key={`b${i}`} flexDirection="row" justifyContent="space-between" alignItems="center" marginY={1}>
            {body}
            {at ? <Text dimColor>{`(${at[0]}.${at[2] ? 'b' : ''}${at[1] + ++y})`}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}

export const register: Register = (on, options) => {
  const cellH = CELL_W * (Number(options.cellAspect) || 2.15)
  const scale = Number(options.scale) || 1
  // read once on first draw, again after a theme change
  let look: Promise<Look> | undefined
  let numbers: Promise<Held> | undefined // read on first use, again after a /clear

  const aspectNow = Number(options.cellAspect) || 2.15
  const round = (n: number) => Math.round(n * 100) / 100

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: CALIBRATE, description: 'Size display math to fill its cells: adjust until no blue shows around the box' })
    return next(e)
  })

  on('command.run', { command: CALIBRATE }, async $ => {
    await update($, trial, () => aspectNow)
    await $.ui.open({ id: CALIBRATE, title: 'Calibrate math', focus: true, closeOnEscape: true, holdToasts: true, rows: 12 })
    return { text: 'Adjust until no blue shows around the light box, then save.' }
  })

  on('ui.render', { component: 'Pane', requestId: CALIBRATE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text, Button, Image } = $.ui.resolve(e)
    const a = (await read($, trial)) || aspectNow
    const png = probe(a, (await (look ??= detect($))).rgb)
    return (
      <Box flexDirection="column">
        <Box width={PROBE_COLUMNS} height={PROBE_ROWS} backgroundColor="#3b6ea5">
          <Image key="probe" source={{ png }} columns={PROBE_COLUMNS} rows={PROBE_ROWS} alt="a box to calibrate against" />
        </Box>
        <Text>
          cellAspect {a.toFixed(2)}{a === aspectNow ? ' (current)' : ` (current ${aspectNow.toFixed(2)})`}
        </Text>
        <Box flexDirection="row">
          <Button key="below" label="Blue above/below" hotkey="v" onPress={() => update($, trial, n => round((n || aspectNow) + 0.01))} />
          <Button key="sides" label="Blue at the sides" hotkey="h" onPress={() => update($, trial, n => round(Math.max(1, (n || aspectNow) - 0.01)))} />
          <Button
            key="save"
            label="Save"
            hotkey="s"
            variant="primary"
            onPress={async () => {
              const { deny } = await $.config.set({ key: 'tex-display.cellAspect', value: a })
              $.ui.toast(deny ? `Not saved: ${deny}` : `cellAspect saved: ${a.toFixed(2)}`)
              if (!deny) await $.ui.close({ id: CALIBRATE })
            }}
          />
        </Box>
      </Box>
    )
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const r = await next(e)
    look = undefined
    return r
  })

  // The model can't know this terminal renders math, and left to itself writes
  // LaTeX as source in a code fence; tell it what gets drawn. prompt.compose and
  // prompt.context would be the natural places, but the built-in security plugin
  // bypasses both for user-installed mods, so it rides along with a prompt: the
  // first one of each context window, since it stays in the history until a
  // compaction or /clear replaces that. (A reload resends it once: harmless.)
  let isTold = false
  on('session.compact', async ($, e, next) => { const r = await next(e); isTold = false; return r })
  on('session.end', ($, e, next) => { if (e.reason === 'clear') { isTold = false; numbers = undefined }; return next(e) })
  on('prompt.submit', async ($, e, next) => {
    const { key, n } = await (numbers ??= numbersOf($))
    if (!(await $.session.surfaces()).includes('terminal')) return next(e)
    const [x, y] = PERSON.includes(e.origin.kind) ? [n.x + 1, 0] : [n.x, n.y]
    const context = [...(e.context ?? []), `Display equations you write from here on are drawn numbered (${x}.${y + 1}), (${x}.${y + 2}), … in order.`]
    const cited = cite(e.text, n)
    if (cited) context.push(cited)
    if (!isTold) context.push(MATH_PROMPT)
    const r = await next({ ...e, context })
    if (r.drop) return r // a dropped prompt never entered, so neither did the context
    isTold = true
    if (x !== n.x) {
      Object.assign(n, { x, y: 0, b: 0 })
      await $.store.set(key, n)
    }
    return r
  })

  // A reply block takes the next Ys; a command's output (the /btw answer below;
  // not its echo, whose arguments may quote math) the next bNs. Subagents' rows
  // are never drawn in the transcript, so never counted.
  on('session.append', async ($, e, next) => {
    const text = e.message.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
    const isSide = e.door === 'command' && text.startsWith('<local-command-stdout>')
    if (e.agentId !== undefined || !(e.door === 'response' || isSide)) return next(e)
    const found = split(text).flatMap(p => ('tex' in p ? [p.tex] : []))
    if (!found.length) return next(e)
    const { key, n } = await (numbers ??= numbersOf($))
    n.tex ??= {}
    if (isSide) {
      n.at[e.uuid] = [n.x, (n.b ??= 0), 1]
      for (const tex of found) n.tex[`${n.x}.b${++n.b}`] = tex
    } else {
      n.at[e.uuid] = [n.x, n.y]
      for (const tex of found) n.tex[`${n.x}.${++n.y}`] = tex
    }
    await $.store.set(key, n)
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const tree = e.surface === 'terminal' && column($, e, e.props.text, await (look ??= detect($)), cellH, scale, await (numbers ??= numbersOf($)))
    if (!tree) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // the engine's own reply rows carry a blank line above and a "● " gutter
    // (the bullet on a reply's first block); a tree drawn here replaces the row
    return (
      <Box flexDirection="row" marginTop={1}>
        <Text>{e.props.isFirstOfReply ? '● ' : '  '}</Text>
        {tree}
      </Box>
    )
  })

  // /btw draws its answer in a panel of its own, which no render hook reaches.
  // So the side question is asked here instead, with the same tool-less fork
  // over the transcript, and its answer printed as the command's output: a
  // transcript row, drawn below like a reply. Bare /btw (the engine's history
  // browser) and a session with nothing to fork yet are left to the engine.
  on('command.run', { command: 'btw' }, async ($, e, next) => {
    if (!e.args.trim()) return next(e)
    const cited = cite(e.args, (await (numbers ??= numbersOf($))).n)
    const r = await $.model.fork({ prompt: `${BTW_NOTE}\n\n${cited && cited + '\n\n'}${e.args}` })
    if (!r.isAnswered && r.reason === 'nothing-to-fork') return next(e)
    return { text: r.isAnswered ? r.text : `_(no answer: ${r.reason})_` }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'btw' } }, async ($, e, next) => {
    const tree = e.surface === 'terminal' && !e.props.isErrored && column($, e, e.props.text, await (look ??= detect($)), cellH, scale, await (numbers ??= numbersOf($)))
    if (!tree) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Text dimColor>{'  ⎿  '}</Text>
        {tree}
      </Box>
    )
  })
}
