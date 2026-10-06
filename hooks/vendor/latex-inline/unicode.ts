import { cellWidth } from './support'

// LaTeX as plain Unicode text, for terminals that can't show the plugin's
// pictures. Symbols become their characters, scripts the small letters
// Unicode has (a caret or an underscore where it has none), fractions and
// roots go on one line, and spacing follows TeX's: the source's spaces are
// dropped, and binary operators and relations get a space on each side.

type Kind = 'ord' | 'op' | 'bin' | 'rel' | 'open' | 'close' | 'punct' | 'space'
// An atom of TeX's math list. `loose`: it ends in a one-character script
// written with a caret or an underscore, so a space keeps what follows apart.
// `bar`: a | or ‖ written without saying whether it opens or closes.
type Atom = { kind: Kind; text: string; loose?: boolean; bar?: boolean }
type Font = { upper: number; lower: number | null; digits: number | null; special: Record<string, string> }

const ORD: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ',
  Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  partial: '∂', nabla: '∇', infty: '∞', forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬',
  emptyset: '∅', varnothing: '∅', ell: 'ℓ', hbar: 'ℏ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', angle: '∠',
  triangle: '△', top: '⊤', bot: '⊥', prime: '′', dagger: '†', dots: '…', ldots: '…', cdots: '⋯',
  vdots: '⋮', ddots: '⋱', vert: '|', Vert: '‖', backslash: '\\',
}

const BIN: Record<string, string> = {
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '•',
  oplus: '⊕', ominus: '⊖', otimes: '⊗', odot: '⊙', cup: '∪', cap: '∩', setminus: '∖', wedge: '∧',
  land: '∧', vee: '∨', lor: '∨',
}

const REL: Record<string, string> = {
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼',
  simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫', lesssim: '≲', gtrsim: '≳', prec: '≺',
  succ: '≻', preceq: '⪯', succeq: '⪰', subset: '⊂', subseteq: '⊆', subsetneq: '⊊', supset: '⊃',
  supseteq: '⊇', in: '∈', notin: '∉', ni: '∋', mid: '∣', parallel: '∥', perp: '⊥', models: '⊨',
  vdash: '⊢', coloneqq: '≔', triangleq: '≜', doteq: '≐', asymp: '≍', to: '→', rightarrow: '→',
  leftarrow: '←', gets: '←', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', iff: '⟺',
  implies: '⟹', impliedby: '⟸', mapsto: '↦', leftrightarrow: '↔', uparrow: '↑', downarrow: '↓',
  longrightarrow: '⟶', longleftarrow: '⟵', longmapsto: '⟼', hookrightarrow: '↪', leadsto: '⇝',
  rightleftharpoons: '⇌',
}

const OP: Record<string, string> = {
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮', bigcup: '⋃',
  bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂', bigvee: '⋁', bigwedge: '⋀',
}

const OPEN: Record<string, string> = { langle: '⟨', lfloor: '⌊', lceil: '⌈', lvert: '|', lVert: '‖', lbrace: '{', lbrack: '[' }
const CLOSE: Record<string, string> = { rangle: '⟩', rfloor: '⌋', rceil: '⌉', rvert: '|', rVert: '‖', rbrace: '}', rbrack: ']' }
const SPACES: Record<string, string> = { quad: '  ', qquad: '    ', enspace: ' ', thinspace: ' ', medspace: ' ', thickspace: ' ' }

// Operator names TeX sets upright, with a space from what they apply to.
const FUNCTIONS = new Set([
  'log', 'ln', 'lg', 'exp', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh', 'arcsin',
  'arccos', 'arctan', 'max', 'min', 'arg', 'argmax', 'argmin', 'lim', 'limsup', 'liminf', 'sup', 'inf',
  'det', 'dim', 'ker', 'deg', 'gcd', 'hom', 'Pr', 'tr', 'Tr', 'rank', 'diag', 'sgn',
])

// Single-character commands: spacing and escaped characters.
const ESCAPED: Record<string, [Kind, string]> = {
  ',': ['space', ' '], ':': ['space', ' '], ';': ['space', ' '], '>': ['space', ' '], ' ': ['space', ' '],
  '!': ['space', ''], '\\': ['space', '; '], '{': ['open', '{'], '}': ['close', '}'], '|': ['ord', '‖'],
  '%': ['ord', '%'], $: ['ord', '$'], '&': ['ord', '&'], '#': ['ord', '#'], _: ['ord', '_'],
}

const IGNORED = new Set(['displaystyle', 'textstyle', 'scriptstyle', 'scriptscriptstyle', 'limits', 'nolimits', 'nonumber', 'notag'])
const SKIPS_ARGUMENT = new Set(['label', 'tag', 'color', 'phantom', 'hphantom', 'vphantom'])
// Sizes the delimiter after them, which stays.
const DELIMITER_SIZES = new Set(['left', 'right', 'middle', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'Biggl', 'Biggr'])
const TEXT = new Set(['text', 'textrm', 'textbf', 'textit', 'textsf', 'texttt', 'textnormal', 'emph', 'mbox', 'hbox'])
// Show their argument as it is.
const STYLES = new Set(['mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathnormal', 'boldsymbol', 'bm', 'underline', 'boxed', 'cancel', 'underbrace', 'overbrace'])
const CLASSES: Record<string, Kind> = { mathord: 'ord', mathop: 'op', mathbin: 'bin', mathrel: 'rel', mathopen: 'open', mathclose: 'close', mathpunct: 'punct' }
const FRACTIONS = new Set(['frac', 'dfrac', 'tfrac', 'cfrac'])
const BINOMIALS = new Set(['binom', 'dbinom', 'tbinom'])

const ACCENTS: Record<string, string> = {
  hat: '̂', widehat: '̂', check: '̌', bar: '̄', overline: '̅', tilde: '̃',
  widetilde: '̃', dot: '̇', ddot: '̈', vec: '⃗', acute: '́', grave: '̀', breve: '̆',
}

const NEGATED: Record<string, string> = {
  '=': '≠', '∈': '∉', '⊂': '⊄', '⊆': '⊈', '⊃': '⊅', '⊇': '⊉', '≡': '≢', '∼': '≁', '<': '≮', '>': '≯',
  '≤': '≰', '≥': '≱', '∣': '∤', '|': '∤', '∃': '∄', '≈': '≉', '≃': '≄', '≅': '≇',
}

// The delimiters an environment puts around its rows.
const ENVIRONMENTS: Record<string, [string, string]> = {
  pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', ''],
}

const DOUBLE_STRUCK: Font = { upper: 0x1d538, lower: 0x1d552, digits: 0x1d7d8, special: { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' } }
const SCRIPT: Font = {
  upper: 0x1d49c, lower: 0x1d4b6, digits: null,
  special: { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' },
}
const FRAKTUR: Font = { upper: 0x1d504, lower: 0x1d51e, digits: null, special: { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' } }
const FONTS: Record<string, Font> = { mathbb: DOUBLE_STRUCK, Bbb: DOUBLE_STRUCK, mathcal: SCRIPT, mathscr: SCRIPT, mathfrak: FRAKTUR }

const SUPERSCRIPTS: Record<string, string> = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '−': '⁻',
  '=': '⁼', '(': '⁽', ')': '⁾', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ',
  j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ',
  x: 'ˣ', y: 'ʸ', z: 'ᶻ', A: 'ᴬ', B: 'ᴮ', D: 'ᴰ', E: 'ᴱ', G: 'ᴳ', H: 'ᴴ', I: 'ᴵ', J: 'ᴶ', K: 'ᴷ',
  L: 'ᴸ', M: 'ᴹ', N: 'ᴺ', O: 'ᴼ', P: 'ᴾ', R: 'ᴿ', T: 'ᵀ', U: 'ᵁ', V: 'ⱽ', W: 'ᵂ', 'α': 'ᵅ', 'β': 'ᵝ',
  'γ': 'ᵞ', 'δ': 'ᵟ', 'ε': 'ᵋ', 'ϵ': 'ᵋ', 'θ': 'ᶿ', 'ι': 'ᶥ', 'φ': 'ᵠ', 'ϕ': 'ᵠ', 'χ': 'ᵡ', '′': '′',
  '*': '*', '∗': '*', '⊤': 'ᵀ', '∘': '°', ',': ',',
}

const SUBSCRIPTS: Record<string, string> = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '−': '₋',
  '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ',
  o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ', 'β': 'ᵦ', 'γ': 'ᵧ', 'ρ': 'ᵨ',
  'φ': 'ᵩ', 'ϕ': 'ᵩ', 'χ': 'ᵪ', ',': ',',
}

const SYMBOLS = new Map<string, [Kind, string]>()
const CHAR_KINDS = new Map<string, Kind>([
  ['+', 'bin'], ['*', 'bin'], ['−', 'bin'], ['=', 'rel'], ['<', 'rel'], ['>', 'rel'], [':', 'rel'],
  [',', 'punct'], [';', 'punct'], ['(', 'open'], ['[', 'open'], [')', 'close'], [']', 'close'], ['!', 'close'], ['?', 'close'],
])
for (const [kind, table] of [['ord', ORD], ['bin', BIN], ['rel', REL], ['op', OP], ['open', OPEN], ['close', CLOSE], ['space', SPACES]] as const) {
  for (const [name, text] of Object.entries(table)) {
    SYMBOLS.set(name, [kind, text])
    if (kind !== 'ord' && kind !== 'space' && !CHAR_KINDS.has(text)) CHAR_KINDS.set(text, kind)
  }
}
SYMBOLS.set('colon', ['punct', ':'])
// A bare | or ‖ opens or closes by where it stands (see kindsOf).
CHAR_KINDS.delete('|')
CHAR_KINDS.delete('‖')

// What puts a fraction's part in parentheses when it is outside brackets.
const OPERATOR_CHARS = new Set([' ', '/', ...[...CHAR_KINDS].filter(([, kind]) => kind === 'bin' || kind === 'rel' || kind === 'punct').map(([text]) => text)])

// TeX's spacing between atoms (The TeXbook, chapter 18): a space between
// these pairs everywhere, and between the second set's outside scripts.
const SPACED = new Set(['ord op', 'op ord', 'op op', 'close op'])
const SPACED_OUTSIDE_SCRIPTS = new Set([
  'ord bin', 'ord rel', 'op rel', 'bin ord', 'bin op', 'bin open', 'rel ord', 'rel op', 'rel open',
  'close bin', 'close rel', 'punct ord', 'punct op', 'punct rel', 'punct open', 'punct close', 'punct punct',
])

const WHITESPACE = /\s/

function atom(kind: Kind, text: string): Atom {
  return kind === 'ord' && (text === '|' || text === '‖') ? { kind, text, bar: true } : { kind, text }
}

function charAtom(ch: string): Atom {
  if (ch === '-') return atom('bin', '−')
  return atom(CHAR_KINDS.get(ch) ?? 'ord', ch)
}

// TeX's rules for a binary operator with nothing on one side to combine
// (`-x`, `a = -b`): it is ordinary, so it gets no spaces. Unlike TeX, a bare
// | or ‖ opens where an operand would start and closes elsewhere, so the
// sign in |-5| is not spaced as a minus.
function kindsOf(atoms: Atom[]): (Kind | undefined)[] {
  const kinds: (Kind | undefined)[] = atoms.map(a => a.kind)
  let previous = -1
  for (let k = 0; k < kinds.length; k++) {
    if (kinds[k] === 'space') continue
    const before = previous < 0 ? null : kinds[previous]
    if (atoms[k]?.bar) {
      const startsOperand = before === null || before === 'bin' || before === 'rel' || before === 'open' || before === 'punct' || before === 'op'
      kinds[k] = startsOperand ? 'open' : 'close'
    }
    const kind = kinds[k]
    if (kind === 'bin' && (before === null || before === 'bin' || before === 'op' || before === 'rel' || before === 'open' || before === 'punct')) {
      kinds[k] = 'ord'
    } else if ((kind === 'rel' || kind === 'close' || kind === 'punct') && before === 'bin') {
      kinds[previous] = 'ord'
    }
    previous = k
  }
  if (previous >= 0 && kinds[previous] === 'bin') kinds[previous] = 'ord'
  return kinds
}

function render(atoms: Atom[], script: boolean): string {
  const kinds = kindsOf(atoms)
  let out = ''
  let previous = -1
  atoms.forEach((current, k) => {
    if (current.kind === 'space') {
      out += current.text
      return
    }
    const left = atoms[previous]
    if (left) {
      const pair = `${kinds[previous]} ${kinds[k]}`
      const isSpaced =
        SPACED.has(pair) ||
        (!script && SPACED_OUTSIDE_SCRIPTS.has(pair)) ||
        (left.loose === true && kinds[k] !== 'close' && kinds[k] !== 'punct')
      if (isSpaced && !out.endsWith(' ') && !current.text.startsWith(' ')) out += ' '
    }
    out += current.text
    previous = k
  })
  return out
}

// Adds a superscript (^) or subscript (_) to the atom before it: in Unicode's
// small letters when it has them all, else written out after the mark.
function attach(atoms: Atom[], mark: '^' | '_', text: string): void {
  if (text === '') return
  const table = mark === '^' ? SUPERSCRIPTS : SUBSCRIPTS
  let base = atoms[atoms.length - 1]
  if (!base || base.kind === 'space') {
    base = atom('ord', '')
    atoms.push(base)
  }
  const chars = [...text]
  if (chars.every(ch => table[ch] !== undefined)) {
    base.text += chars.map(ch => table[ch]).join('')
  } else if (chars.length === 1) {
    base.text += mark + text
    base.loose = true
  } else {
    base.text += /^\(.*\)$/.test(text) ? mark + text : `${mark}(${text})`
  }
}

// A {...} group is one atom: itself when it holds one, else an ordinary one.
function group(atoms: Atom[], script: boolean): Atom {
  const [only] = atoms
  return atoms.length === 1 && only ? only : atom('ord', render(atoms, script))
}

// A fraction's part or a root's body on one line, at full size and so spaced
// as text, in parentheses when it holds an operator or a space outside brackets.
function linear(atoms: Atom[]): string {
  const text = render(atoms, false)
  let depth = 0
  let index = 0
  for (const ch of text) {
    // A leading sign needs no parentheses: −b/2a.
    if (index++ === 0 && (ch === '−' || ch === '+')) continue
    if ('([{⟨⌊⌈'.includes(ch)) depth++
    else if (')]}⟩⌋⌉'.includes(ch)) depth--
    else if (depth === 0 && OPERATOR_CHARS.has(ch)) return `(${text})`
  }
  return text
}

function styled(text: string, font: Font): string {
  return [...text]
    .map(ch => {
      const special = font.special[ch]
      if (special) return special
      const code = ch.codePointAt(0) ?? 0
      if (code >= 65 && code <= 90) return String.fromCodePoint(font.upper + code - 65)
      if (font.lower !== null && code >= 97 && code <= 122) return String.fromCodePoint(font.lower + code - 97)
      if (font.digits !== null && code >= 48 && code <= 57) return String.fromCodePoint(font.digits + code - 48)
      return ch
    })
    .join('')
}

function combine(text: string, mark: string): string {
  return [...text].map(ch => (WHITESPACE.test(ch) ? ch : ch + mark)).join('')
}

function root(index: string | null): string {
  if (index === null) return '√'
  const degree = texToUnicode(index)
  if (degree === '3') return '∛'
  if (degree === '4') return '∜'
  const small = [...degree].map(ch => SUPERSCRIPTS[ch])
  return small.every(ch => ch !== undefined) ? `${small.join('')}√` : `${degree}√`
}

// \text{} keeps its spaces; math inside it is converted too.
function textOf(raw: string): string {
  return raw
    .replace(/\\\$/g, '\u0000')
    .replace(/\$([^$]+)\$/g, (_, tex: string) => texToUnicode(tex))
    .replace(/(?<!\\)[{}]/g, '')
    .replace(/\\([%&#_{} ])/g, '$1')
    .replace(/\u0000/g, '$')
}

class Reader {
  private i = 0
  private readonly environments: string[] = []

  constructor(private readonly s: string) {}

  // The atoms up to `stop`, left unread, or the end.
  atoms(script: boolean, stop?: string): Atom[] {
    const out: Atom[] = []
    while (this.i < this.s.length) {
      const ch = this.s[this.i] ?? ''
      if (ch === stop) break
      if (WHITESPACE.test(ch) || ch === '}') {
        this.i++
      } else if (ch === '^' || ch === '_') {
        this.i++
        attach(out, ch, render(this.argument(true), true))
      } else if (ch === "'") {
        this.i++
        attach(out, '^', '′')
      } else if (ch === '{') {
        out.push(group(this.group(script), script))
      } else if (ch === '\\') {
        out.push(...this.command(script))
      } else if (ch === '&') {
        this.i++
        out.push(atom('space', this.environments[this.environments.length - 1] === 'cases' ? ', ' : ' '))
      } else if (ch === '~') {
        this.i++
        out.push(atom('space', ' '))
      } else {
        const char = String.fromCodePoint(this.s.codePointAt(this.i) ?? 0)
        this.i += char.length
        out.push(charAtom(char))
      }
    }
    return out
  }

  // The atoms of a {...} group, its braces read.
  private group(script: boolean): Atom[] {
    this.i++
    const inner = this.atoms(script, '}')
    this.i++
    return inner
  }

  // One argument: a {...} group, a command or a character.
  private argument(script: boolean): Atom[] {
    this.skipSpaces()
    const ch = this.s[this.i]
    if (ch === undefined) return []
    if (ch === '{') return this.group(script)
    if (ch === '\\') return this.command(script)
    const char = String.fromCodePoint(this.s.codePointAt(this.i) ?? 0)
    this.i += char.length
    return [charAtom(char)]
  }

  // A {...} argument's text as written, for \text and environment names.
  private raw(): string {
    this.skipSpaces()
    if (this.s[this.i] !== '{') {
      const ch = this.s[this.i] ?? ''
      this.i += ch.length
      return ch
    }
    const start = this.i + 1
    let depth = 0
    for (; this.i < this.s.length; this.i++) {
      const ch = this.s[this.i]
      if (ch === '\\') this.i++
      else if (ch === '{') depth++
      else if (ch === '}' && --depth === 0) break
    }
    const text = this.s.slice(start, this.i)
    this.i++
    return text
  }

  private optional(): string | null {
    this.skipSpaces()
    if (this.s[this.i] !== '[') return null
    const end = this.s.indexOf(']', this.i)
    if (end < 0) return null
    const text = this.s.slice(this.i + 1, end)
    this.i = end + 1
    return text
  }

  private skipSpaces(): void {
    while (WHITESPACE.test(this.s[this.i] ?? '')) this.i++
  }

  private command(script: boolean): Atom[] {
    this.i++
    const name = /^[A-Za-z]+/.exec(this.s.slice(this.i))?.[0]
    if (name === undefined) {
      const ch = this.s[this.i] ?? ''
      this.i += ch.length
      const escaped = ESCAPED[ch]
      return ch === '' ? [] : [escaped ? atom(...escaped) : atom('ord', ch)]
    }
    this.i += name.length

    const symbol = SYMBOLS.get(name)
    if (symbol) return [atom(...symbol)]
    if (FUNCTIONS.has(name)) return [atom('op', name)]
    if (IGNORED.has(name)) return []
    if (DELIMITER_SIZES.has(name)) {
      this.skipSpaces()
      if (this.s[this.i] === '.') this.i++
      return []
    }
    if (SKIPS_ARGUMENT.has(name)) {
      this.raw()
      return []
    }
    if (TEXT.has(name)) return [atom('ord', textOf(this.raw()))]
    if (STYLES.has(name)) return [group(this.argument(script), script)]
    const kind = CLASSES[name]
    if (kind) return [atom(kind, render(this.argument(script), script))]
    const font = FONTS[name]
    if (font) return [atom('ord', styled(render(this.argument(script), script), font))]
    const accent = ACCENTS[name]
    if (accent) return [atom('ord', combine(render(this.argument(script), script), accent))]
    if (name === 'operatorname') {
      if (this.s[this.i] === '*') this.i++
      return [atom('op', render(this.argument(script), script))]
    }
    if (FRACTIONS.has(name)) {
      const top = linear(this.argument(false))
      return [atom('ord', `${top}/${linear(this.argument(false))}`)]
    }
    if (BINOMIALS.has(name)) {
      const top = render(this.argument(false), false)
      return [atom('ord', `C(${top}, ${render(this.argument(false), false)})`)]
    }
    if (name === 'sqrt') {
      const index = this.optional()
      return [atom('ord', `${root(index)}${linear(this.argument(false))}`)]
    }
    if (name === 'overset' || name === 'stackrel' || name === 'underset') {
      const note = render(this.argument(true), true)
      const atoms = [group(this.argument(script), script)]
      attach(atoms, name === 'underset' ? '_' : '^', note)
      return atoms
    }
    if (name === 'textcolor') {
      this.raw()
      return this.argument(script)
    }
    if (name === 'not') {
      const negated = render(this.argument(script), script)
      return [atom('rel', NEGATED[negated] ?? combine(negated, '̸'))]
    }
    if (name === 'mod' || name === 'bmod') return [atom('space', ' '), atom('bin', 'mod'), atom('space', ' ')]
    if (name === 'pmod') return [atom('space', ' '), atom('ord', `(mod ${render(this.argument(script), script)})`)]
    if (name === 'begin') {
      const environment = this.raw()
      this.environments.push(environment)
      if (environment === 'array') this.raw()
      const open = ENVIRONMENTS[environment]?.[0]
      return open ? [atom('open', open)] : []
    }
    if (name === 'end') {
      const close = ENVIRONMENTS[this.raw()]?.[1]
      this.environments.pop()
      return close ? [atom('close', close)] : []
    }
    return [{ kind: 'ord', text: `\\${name}`, loose: true }]
  }
}

export function texToUnicode(tex: string): string {
  return render(new Reader(tex).atoms(false), false).trim()
}

const DIGIT = /[0-9]/
const FENCE = /^\s*(`{3,}|~{3,})/
// Pads display math. Markdown drops spaces at the start of a line but keeps
// no-break spaces.
const PAD = ' '
// What Markdown would read as markup in converted math.
const MARKDOWN_SPECIAL = /[\\`*_[\]<>|#~&]/g

type Formula = { end: number; tex: string }

// The formula a $ at `open` starts, by the reply parser's rules (see
// closingDollar in parse.ts): where it ends and its TeX, or null when the
// dollar is text.
function formulaAt(s: string, open: number): Formula | null {
  if (s[open + 1] === '$') {
    const end = s.indexOf('$$', open + 2)
    return end > open + 2 ? { end: end + 2, tex: s.slice(open + 2, end).trim() } : null
  }
  const first = s[open + 1]
  if (first === undefined || WHITESPACE.test(first)) return null
  for (let j = open + 1; j < s.length; j++) {
    const ch = s[j]
    if (ch === '\\') {
      j++
      continue
    }
    if (ch === '`') return null
    if (ch !== '$') continue
    const after = s[j + 1]
    const isClosing = !WHITESPACE.test(s[j - 1] ?? ' ') && !(after !== undefined && DIGIT.test(after))
    return isClosing ? { end: j + 1, tex: s.slice(open + 1, j) } : null
  }
  return null
}

// The formula a \( or \[ at `open` starts, or null.
function bracketedAt(s: string, open: number): Formula | null {
  const kind = s[open + 1]
  if (kind !== '(' && kind !== '[') return null
  const end = s.indexOf(kind === '(' ? '\\)' : '\\]', open + 2)
  return end > open + 2 ? { end: end + 2, tex: s.slice(open + 2, end).trim() } : null
}

// Where the next run of exactly `length` backticks starts, or -1: the end of
// the code span such a run opened.
function closingRun(s: string, from: number, length: number): number {
  let j = from
  while (j < s.length) {
    if (s[j] !== '`') {
      j++
      continue
    }
    let run = 1
    while (s[j + run] === '`') run++
    if (run === length) return j
    j += run
  }
  return -1
}

function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_SPECIAL, ch => `\\${ch}`)
}

// A formula as Unicode, or null when it can't be converted.
function plainOf(tex: string): string | null {
  try {
    return texToUnicode(tex)
  } catch {
    return null
  }
}

// One paragraph with its math converted and its code spans as written.
function convertParagraph(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    const ch = s[i] ?? ''
    if (ch === '`') {
      let run = 1
      while (s[i + run] === '`') run++
      const close = closingRun(s, i + run, run)
      const end = close < 0 ? i + run : close + run
      out += s.slice(i, end)
      i = end
      continue
    }
    const formula = ch === '$' ? formulaAt(s, i) : ch === '\\' ? bracketedAt(s, i) : null
    const plain = formula ? plainOf(formula.tex) : null
    if (formula && plain !== null) {
      out += escapeMarkdown(plain)
      i = formula.end
    } else if (ch === '\\') {
      out += s.slice(i, i + 2)
      i += 2
    } else {
      out += ch
      i++
    }
  }
  return out
}

// A paragraph that is one formula and nothing else is display math, centered
// in `width` cells or indented when the width is unknown.
function convertBlock(lines: string[], width: number | undefined): string {
  const text = lines.join('\n')
  const trimmed = text.trim()
  const formula = trimmed.startsWith('$$') ? formulaAt(trimmed, 0) : trimmed.startsWith('\\[') ? bracketedAt(trimmed, 0) : null
  const plain = formula && formula.end === trimmed.length ? plainOf(formula.tex) : null
  if (plain === null) return convertParagraph(text)
  const indent = /^\s*/.exec(text)?.[0] ?? ''
  const pad = width === undefined ? 4 : Math.max(0, Math.floor((width - cellWidth(indent) - cellWidth(plain)) / 2))
  return indent + PAD.repeat(pad) + escapeMarkdown(plain)
}

// A reply's math as Unicode text, its markdown otherwise as written: fenced
// code keeps its dollars, a formula alone in its paragraph is centered in
// `width` cells, and what Markdown would read as markup in the converted math
// is escaped.
export function unicodeMath(markdown: string, width?: number): string {
  const out: string[] = []
  let paragraph: string[] = []
  let fence: string | null = null
  const flush = () => {
    if (paragraph.length > 0) out.push(convertBlock(paragraph, width))
    paragraph = []
  }
  for (const line of markdown.split('\n')) {
    if (fence !== null) {
      out.push(line)
      if (line.trim().startsWith(fence)) fence = null
      continue
    }
    const opening = FENCE.exec(line)
    if (opening) {
      flush()
      fence = opening[1] ?? '```'
      out.push(line)
    } else if (line.trim() === '') {
      flush()
      out.push(line)
    } else {
      paragraph.push(line)
    }
  }
  flush()
  return out.join('\n')
}
