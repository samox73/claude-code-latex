// Fills MathJax's SVG output (a LiteElement tree, fontCache 'none') into a
// coverage mask. MathJax draws glyphs as filled <path>s and rules as <rect>s
// inside nested <g transform>, the stretched middle of a stretchy brace, arrow
// or delimiter inside a nested <svg> viewport that clips it, and frames and
// strikes (\boxed, \fbox, \cancel, \enclose) as stroked <rect>/<ellipse>/<line>.
// Fills and strokes are each filled with the nonzero rule on a layer of their
// own, then merged, so a stroke crossing a glyph never cancels against it.
// ponytail: \color is ignored (all ink in one colour); add when it's wanted.

export type SvgNode = {
  kind: string
  attributes?: Record<string, string>
  children?: SvgNode[]
}

type Mat = [number, number, number, number, number, number] // x' = a x + c y + e, y' = b x + d y + f
type Edge = [number, number, number, number]
type Pt = [number, number]
type Rect = [number, number, number, number] // device-space x0, y0, x1, y1

const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

function transform(m: Mat, s: string | undefined): Mat {
  if (!s) return m
  for (const [, fn, args] of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = args.split(/[\s,]+/).filter(Boolean).map(Number)
    if (fn === 'translate') m = mul(m, [1, 0, 0, 1, v[0], v[1] ?? 0])
    else if (fn === 'scale') m = mul(m, [v[0], 0, 0, v[1] ?? v[0], 0, 0])
    else if (fn === 'matrix') m = mul(m, v as Mat)
  }
  return m
}

const apply = (m: Mat, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

// Flattens SVG path data into closed device-space contours. Quadratic/cubic
// curves are cut into fixed 8 segments: at glyph sizes of ~20px that is
// sub-pixel accurate.
function pathContours(d: string, m: Mat): Pt[][] {
  const tok = d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []
  const out: Pt[][] = []
  let cur: Pt[] = []
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0
  const num = () => Number(tok[i++])
  const close = () => { if (cur.length > 2) out.push(cur); cur = [] } // filling closes every contour
  const line = (nx: number, ny: number) => { cur.push(apply(m, nx, ny)); x = nx; y = ny }
  const curve = (pts: number[][]) => { // pts: control points after the current one
    const p = [[x, y], ...pts]
    for (let k = 1; k <= 8; k++) {
      const t = k / 8
      let q = p
      while (q.length > 1) q = q.slice(1).map((pt, j) => [q[j][0] + (pt[0] - q[j][0]) * t, q[j][1] + (pt[1] - q[j][1]) * t])
      line(q[0][0], q[0][1])
    }
  }
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++]
    const rel = cmd === cmd.toLowerCase(), ox = rel ? x : 0, oy = rel ? y : 0
    switch (cmd.toUpperCase()) {
      case 'M': close(); x = sx = num() + ox; y = sy = num() + oy; cx = x; cy = y; cur.push(apply(m, x, y)); cmd = rel ? 'l' : 'L'; break
      case 'L': line(num() + ox, num() + oy); cx = x; cy = y; break
      case 'H': line(num() + ox, y); cx = x; cy = y; break
      case 'V': line(x, num() + oy); cx = x; cy = y; break
      case 'Q': { const c1 = [num() + ox, num() + oy], p = [num() + ox, num() + oy]; curve([c1, p]); [cx, cy] = c1; break }
      case 'T': { const c1 = [2 * x - cx, 2 * y - cy], p = [num() + ox, num() + oy]; curve([c1, p]); [cx, cy] = c1; break }
      case 'C': { const c1 = [num() + ox, num() + oy], c2 = [num() + ox, num() + oy], p = [num() + ox, num() + oy]; curve([c1, c2, p]); [cx, cy] = c2; break }
      case 'S': { const c1 = [2 * x - cx, 2 * y - cy], c2 = [num() + ox, num() + oy], p = [num() + ox, num() + oy]; curve([c1, c2, p]); [cx, cy] = c2; break }
      case 'Z': close(); x = sx; y = sy; cx = x; cy = y; cur.push(apply(m, x, y)); break
      default: close(); return out // arcs and anything else: MathJax glyph data has none
    }
  }
  close()
  return out
}

// Sutherland–Hodgman against an axis-aligned rectangle. On a concave contour it
// can leave zero-area slivers along the rectangle's edge; those add no coverage.
function clipContour(p: Pt[], r: Rect): Pt[] {
  for (const [axis, bound, sign] of [[0, r[0], 1], [0, r[2], -1], [1, r[1], 1], [1, r[3], -1]] as const) {
    const inside = (q: Pt) => sign * (q[axis] - bound) >= 0
    const cross = (a: Pt, b: Pt): Pt => {
      const t = (bound - a[axis]) / (b[axis] - a[axis])
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    const next: Pt[] = []
    p.forEach((q, k) => {
      const prev = p[(k + p.length - 1) % p.length]
      if (inside(q)) { if (!inside(prev)) next.push(cross(prev, q)); next.push(q) }
      else if (inside(prev)) next.push(cross(prev, q))
    })
    p = next
    if (p.length < 3) return []
  }
  return p
}

function emit(contours: Pt[][], clip: Rect | null, out: Edge[]) {
  for (let c of contours) {
    if (clip) c = clipContour(c, clip)
    c.forEach((q, k) => { const n = c[(k + 1) % c.length]; out.push([q[0], q[1], n[0], n[1]]) })
  }
}

// A nested <svg> is a viewport: placed at (x, y), its viewBox mapped onto
// width×height (MathJax never sets preserveAspectRatio, and its viewBox always
// has the viewport's aspect, so a plain scale is exact), clipping what it draws.
function viewport(a: Record<string, string>, m: Mat, clip: Rect | null): [Mat, Rect | null] {
  const x = +(a.x ?? 0), y = +(a.y ?? 0), w = +(a.width ?? 0), h = +(a.height ?? 0)
  const [vx, vy, vw, vh] = (a.viewBox ?? `0 0 ${w} ${h}`).split(/[\s,]+/).map(Number)
  const inner = mul(mul(m, [1, 0, 0, 1, x, y]), [vw ? w / vw : 1, 0, 0, vh ? h / vh : 1, -vx * (vw ? w / vw : 1), -vy * (vh ? h / vh : 1)])
  if (m[1] !== 0 || m[2] !== 0) return [inner, clip] // rotated: no axis-aligned clip; MathJax never rotates
  const [p, q] = [apply(m, x, y), apply(m, x + w, y + h)]
  let r: Rect = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])]
  if (clip) r = [Math.max(r[0], clip[0]), Math.max(r[1], clip[1]), Math.min(r[2], clip[2]), Math.min(r[3], clip[3])]
  return [inner, r]
}

type Layers = { fill: Edge[]; stroke: Edge[] }

const signedArea = (c: Pt[]) => c.reduce((s, p, k) => { const q = c[(k + 1) % c.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0)

// A stroke as polygons: one quad per segment (butt ends), plus a square on
// every vertex of a closed outline with sharp corners (a rectangle's mitred
// corners). All oriented alike, so on their own layer they simply union.
function strokeContours(pts: Pt[], closed: boolean, corners: boolean, width: number, m: Mat): Pt[][] {
  const hw = width / 2, out: Pt[][] = []
  for (let k = 0; k < (closed ? pts.length : pts.length - 1); k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const nx = (-(b[1] - a[1]) / len) * hw, ny = ((b[0] - a[0]) / len) * hw
    out.push([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]])
  }
  if (closed && corners) for (const [x, y] of pts) out.push([[x - hw, y - hw], [x + hw, y - hw], [x + hw, y + hw], [x - hw, y + hw]])
  return out.map(c => { const d = c.map(([x, y]) => apply(m, x, y)); return signedArea(d) < 0 ? d.reverse() : d })
}

// Outline of a rectangle with corner radius r (0: sharp) or of an ellipse, in user space.
function roundRect(x: number, y: number, w: number, h: number, r: number): Pt[] {
  if (r <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
  r = Math.min(r, w / 2, h / 2)
  const out: Pt[] = []
  for (const [cx, cy, a0] of [[x + w - r, y + r, -90], [x + w - r, y + h - r, 0], [x + r, y + h - r, 90], [x + r, y + r, 180]])
    for (let k = 0; k <= 8; k++) { const t = ((a0 + (k * 90) / 8) * Math.PI) / 180; out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]) }
  return out
}
const ellipse = (cx: number, cy: number, rx: number, ry: number): Pt[] =>
  Array.from({ length: 64 }, (_, k) => [cx + rx * Math.cos((k * Math.PI) / 32), cy + ry * Math.sin((k * Math.PI) / 32)])

function collect(n: SvgNode, m: Mat, clip: Rect | null, out: Layers) {
  const a = n.attributes ?? {}
  if (a['data-mml-node'] === 'merror') throw new Error('TeX error')
  m = transform(m, a.transform)
  if (n.kind === 'svg') [m, clip] = viewport(a, m, clip)
  const sw = n.kind === 'g' ? 0 : +(a['stroke-width'] ?? 0) // on a <g> it only resets inheritance
  const filled = a.fill !== 'none'
  const shape = (pts: Pt[], closed: boolean, corners: boolean) => {
    if (filled && closed) emit([pts.map(([x, y]) => apply(m, x, y))], clip, out.fill)
    if (sw > 0) emit(strokeContours(pts, closed, corners, sw, m), clip, out.stroke)
  }
  if (n.kind === 'path' && a.d && filled) emit(pathContours(a.d, m), clip, out.fill)
  if (n.kind === 'rect') {
    const r = +(a.rx ?? a.ry ?? 0)
    shape(roundRect(+(a.x ?? 0), +(a.y ?? 0), +(a.width ?? 0), +(a.height ?? 0), r), true, r <= 0)
  }
  if (n.kind === 'ellipse' || n.kind === 'circle') shape(ellipse(+(a.cx ?? 0), +(a.cy ?? 0), +(a.rx ?? a.r ?? 0), +(a.ry ?? a.r ?? 0)), true, false)
  if (n.kind === 'line') shape([[+(a.x1 ?? 0), +(a.y1 ?? 0)], [+(a.x2 ?? 0), +(a.y2 ?? 0)]], false, false)
  for (const c of n.children ?? []) collect(c, m, clip, out)
}

/** The root <svg>'s viewBox: [minX, minY, width, height] in 1/1000 em. */
export const viewBox = (svg: SvgNode) => (svg.attributes?.viewBox ?? '0 0 0 0').split(/\s+/).map(Number)

/**
 * Fills `svg` into a `width`×`height` coverage mask (one byte per pixel, 255 =
 * fully inside), `pxPerEm` pixels per em, placed at pixel offset (`dx`, `dy`).
 */
export function rasterize(svg: SvgNode, o: { width: number; height: number; pxPerEm: number; dx: number; dy: number }) {
  const [minX, minY] = viewBox(svg), s = o.pxPerEm / 1000
  const layers: Layers = { fill: [], stroke: [] }
  for (const c of svg.children ?? []) collect(c, [s, 0, 0, s, o.dx - minX * s, o.dy - minY * s], null, layers) // the root's viewBox is mapped here
  const px = cover(layers.fill, o.width, o.height)
  if (layers.stroke.length) cover(layers.stroke, o.width, o.height).forEach((v, i) => { if (v > px[i]) px[i] = v })
  return px
}

// Nonzero-winding fill of `edges` into a W×H coverage mask, SS sub-scanlines per
// pixel row with exact horizontal coverage.
function cover(edges: Edge[], W: number, H: number) {
  const SS = 5
  const acc = new Float32Array(W)
  const px = new Uint8Array(W * H)
  const byRow: Edge[][] = Array.from({ length: H }, () => []) // each edge listed under the rows it spans
  for (const e of edges) {
    const lo = Math.max(0, Math.floor(Math.min(e[1], e[3]))), hi = Math.min(H - 1, Math.floor(Math.max(e[1], e[3])))
    for (let r = lo; r <= hi; r++) byRow[r].push(e)
  }
  for (let row = 0; row < H; row++) {
    const live = byRow[row]
    if (!live.length) continue
    acc.fill(0)
    for (let k = 0; k < SS; k++) {
      const y = row + (k + 0.5) / SS
      const xs: [number, number][] = []
      for (const [x0, y0, x1, y1] of live) {
        if ((y0 <= y) === (y1 <= y)) continue
        xs.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1])
      }
      xs.sort((p, q) => p[0] - q[0])
      let wind = 0
      for (let j = 0; j < xs.length - 1; j++) {
        wind += xs[j][1]
        if (wind !== 0) span(acc, xs[j][0], xs[j + 1][0], 1 / SS)
      }
    }
    for (let i = 0; i < W; i++) if (acc[i] > 0) px[row * W + i] = Math.round(Math.min(1, acc[i]) * 255)
  }
  return px
}

// Adds horizontal coverage of [xa, xb) with weight w, fractional at both ends.
function span(acc: Float32Array, xa: number, xb: number, w: number) {
  xa = Math.max(0, xa); xb = Math.min(acc.length, xb)
  if (xb <= xa) return
  const ia = Math.floor(xa), ib = Math.floor(xb)
  if (ia === ib) { acc[ia] += (xb - xa) * w; return }
  acc[ia] += (ia + 1 - xa) * w
  for (let i = ia + 1; i < ib; i++) acc[i] += w
  if (ib < acc.length) acc[ib] += (xb - ib) * w
}
