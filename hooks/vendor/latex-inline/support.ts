export type Ink = { math: string; code: string }

// Claude Code's dark and light themes; `code` is a blue near each theme's own
// inline-code color, for code spans in a paragraph the mod draws itself.
const DARK_INK: Ink = { math: '#e8e8e8', code: '#b1b9f9' }
const LIGHT_INK: Ink = { math: '#24292f', code: '#5769f7' }

export type MathStyle = 'pictures' | 'text' | 'off'

// Pictures reach the screen through the kitty graphics protocol's Unicode
// placeholders, which Ghostty (and cmux, built on it) and kitty speak; tmux
// passes none of it through.
function showsPictures(env: Record<string, string | undefined>): boolean {
  if (env.TMUX) return false
  return (
    env.TERM_PROGRAM === 'ghostty' ||
    env.TERM === 'xterm-ghostty' ||
    Boolean(env.TERM?.includes('kitty')) ||
    Boolean(env.KITTY_WINDOW_ID)
  )
}

// How replies show their math: pictures where the terminal can draw them,
// Unicode text elsewhere. `mode` is the user's override: `on` always draws
// pictures, `text` always writes Unicode, `off` leaves the LaTeX as written.
export function mathStyle(env: Record<string, string | undefined>, mode: string): MathStyle {
  if (mode === 'off') return 'off'
  if (mode === 'text') return 'text'
  if (mode === 'on') return 'pictures'
  return showsPictures(env) ? 'pictures' : 'text'
}

// Terminal cells a string takes: Hangul, CJK and emoji take two, combining
// marks none.
export function cellWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    const isCombining =
      (c >= 0x0300 && c <= 0x036f) ||
      (c >= 0x1ab0 && c <= 0x1aff) ||
      (c >= 0x1dc0 && c <= 0x1dff) ||
      (c >= 0x20d0 && c <= 0x20ff) ||
      (c >= 0xfe20 && c <= 0xfe2f)
    if (isCombining) continue
    const isWide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff)
    width += isWide ? 2 : 1
  }
  return width
}

// Formula ink for Claude Code's theme; a `#rrggbb` color overrides it.
export function inkFor(theme: string | undefined, color: string): Ink {
  const ink = theme?.startsWith('light') ? LIGHT_INK : DARK_INK
  return /^#[0-9a-fA-F]{6}$/.test(color) ? { ...ink, math: color } : ink
}
