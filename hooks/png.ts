// A minimal PNG encoder for coverage masks: a 4-bit palette image whose index is
// the opacity in 16 levels (PLTE = the ink colour 16 times, tRNS = 0, 17, …, 255),
// compressed with LZ77 (hash chains, 32 KiB window) in one fixed-Huffman deflate
// block. A drawn message may carry at most 2 MiB of Image source, so size is
// what bounds how many equations one reply can show.
// ponytail: fixed Huffman codes; dynamic ones (what zlib adds on top) save ~10% more.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const WINDOW = 32768, CHAIN = 8 // how many earlier positions one match search tries

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})

const bucket = (t: number[], v: number) => { let j = t.length - 1; while (t[j] > v) j--; return j }

export function deflate(data: Uint8Array): Uint8Array {
  const out: number[] = []
  let acc = 0, n = 0
  const put = (v: number, len: number) => { // LSB-first, as deflate packs data bits
    acc |= v << n; n += len
    while (n >= 8) { out.push(acc & 255); acc >>>= 8; n -= 8 }
  }
  const code = (c: number, len: number) => { // Huffman codes go MSB-first
    let r = 0
    for (let k = 0; k < len; k++) r |= ((c >> k) & 1) << (len - 1 - k)
    put(r, len)
  }
  const sym = (s: number) => {
    if (s < 144) code(0x30 + s, 8)
    else if (s < 256) code(0x190 + s - 144, 9)
    else if (s < 280) code(s - 256, 7)
    else code(0xc0 + s - 280, 8)
  }

  const head = new Int32Array(1 << 16).fill(-1), prev = new Int32Array(WINDOW)
  const hash = (i: number) => ((data[i] << 8) ^ (data[i + 1] << 4) ^ data[i + 2]) & 0xffff
  const insert = (i: number) => { if (i + 2 < data.length) { const k = hash(i); prev[i % WINDOW] = head[k]; head[k] = i } }

  put(1, 1); put(1, 2) // final block, fixed Huffman
  for (let i = 0; i < data.length;) {
    let best = 0, dist = 0
    if (i + 2 < data.length) {
      const max = Math.min(258, data.length - i)
      for (let p = head[hash(i)], tries = CHAIN; p >= 0 && i - p <= WINDOW && tries-- > 0; p = prev[p % WINDOW]) {
        let l = 0
        while (l < max && data[p + l] === data[i + l]) l++
        if (l > best) { best = l; dist = i - p; if (l === max) break }
      }
    }
    if (best < 3) { sym(data[i]); insert(i); i++; continue }
    const lj = bucket(LEN_BASE, best), dj = bucket(DIST_BASE, dist)
    sym(257 + lj); put(best - LEN_BASE[lj], LEN_EXTRA[lj])
    code(dj, 5); put(dist - DIST_BASE[dj], DIST_EXTRA[dj])
    for (let k = 0; k < best; k++) insert(i + k)
    i += best
  }
  sym(256)
  if (n > 0) out.push(acc & 255)
  return Uint8Array.from(out)
}

/** PNG of a `width`×`height` coverage mask (0..255 per pixel), drawn in `rgb`. */
export function encodePng(alpha: Uint8Array, width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const stride = (width + 1) >> 1 // two 4-bit pixels per byte
  const raw = new Uint8Array((stride + 1) * height) // each row: filter byte 0, then indices
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const q = Math.round(alpha[y * width + x] / 17)
      raw[y * (stride + 1) + 1 + (x >> 1)] |= x & 1 ? q : q << 4
    }

  let a = 1, b = 0
  for (const v of raw) { a = (a + v) % 65521; b = (b + a) % 65521 }
  const z = deflate(raw)
  const zlib = new Uint8Array(z.length + 6)
  zlib.set([0x78, 0x01]); zlib.set(z, 2)
  new DataView(zlib.buffer).setUint32(z.length + 2, ((b << 16) | a) >>> 0)

  const ihdr = new Uint8Array(13)
  new DataView(ihdr.buffer).setUint32(0, width)
  new DataView(ihdr.buffer).setUint32(4, height)
  ihdr.set([4, 3, 0, 0, 0], 8) // 4-bit, palette
  const plte = new Uint8Array(48)
  for (let i = 0; i < 16; i++) plte.set(rgb, i * 3)
  const trns = Uint8Array.from({ length: 16 }, (_, i) => i * 17)

  const chunks: [string, Uint8Array][] = [['IHDR', ihdr], ['PLTE', plte], ['tRNS', trns], ['IDAT', zlib], ['IEND', new Uint8Array(0)]]
  const png = new Uint8Array(8 + chunks.reduce((s, [, d]) => s + d.length + 12, 0))
  png.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(png.buffer)
  let at = 8
  for (const [type, data] of chunks) {
    view.setUint32(at, data.length)
    png.set([...type].map(c => c.charCodeAt(0)), at + 4)
    png.set(data, at + 8)
    let c = 0xffffffff
    for (let k = at + 4; k < at + 8 + data.length; k++) c = CRC[(c ^ png[k]) & 255] ^ (c >>> 8)
    view.setUint32(at + 8 + data.length, (c ^ 0xffffffff) >>> 0)
    at += data.length + 12
  }
  return png
}
