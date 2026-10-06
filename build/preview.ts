// Dev check: node build/preview.ts '<tex>' out.png [px-per-em] renders one equation to a PNG to eyeball.
import { tex2svg } from '../hooks/mathjax/mathjax-entry.js'
import { rasterize, viewBox } from '../hooks/raster.ts'
import { encodePng } from '../hooks/png.ts'
import { writeFileSync } from 'node:fs'
const svg = tex2svg(process.argv[2] || 'G(\\tau) = -\\langle T_\\tau c(\\tau) c^\\dagger(0)\\rangle, \\quad \\Sigma = \\frac{1}{N_q}\\sum_{\\mathbf q} |g|^2 \\sqrt{x}')
const [, , w, h] = viewBox(svg), em = Number(process.argv[4] ?? 38)
const W = Math.ceil(w / 1000 * em), H = Math.ceil(h / 1000 * em)
const t = performance.now()
const px = encodePng(rasterize(svg, { width: W, height: H, pxPerEm: em, dx: 0, dy: 0 }), W, H, [0, 0, 0])
console.log(W, H, (performance.now() - t).toFixed(1), 'ms', px.length, 'bytes PNG vs', W * H * 4, 'RGBA')
writeFileSync(process.argv[3] ?? 'out.png', px)
