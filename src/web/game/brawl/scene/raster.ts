/**
 * Buffer RGBA puro (sem DOM, sem Pixi): a arte das arenas é pintada aqui, uma vez, e a cena sobe o resultado como
 * textura. O script de preview usa o mesmo código para gerar PNG, então o que se vê no PNG é o que o jogo desenha.
 */

export const BAYER4: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
]

/** limiar (0..1) da ordenação de Bayer 4x4 para o pixel x,y */
export const bayer = (x: number, y: number): number => (BAYER4[y & 3]![x & 3]! + 0.5) / 16

export const hexToInt = (c: string): number => parseInt(c.replace('#', ''), 16)
export const intToHex = (n: number): string => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`

export const rgbOfInt = (n: number): [number, number, number] => [(n >> 16) & 255, (n >> 8) & 255, n & 255]

/** mistura dois 0xRRGGBB (k=0 devolve a, k=1 devolve b) */
export function mix(a: number, b: number, k: number): number {
  const [ar, ag, ab] = rgbOfInt(a)
  const [br, bg, bb] = rgbOfInt(b)
  const r = Math.round(ar + (br - ar) * k)
  const g = Math.round(ag + (bg - ag) * k)
  const bl = Math.round(ab + (bb - ab) * k)
  return (r << 16) | (g << 8) | bl
}

/** multiplica o brilho */
export function shadeInt(c: number, k: number): number {
  const [r, g, b] = rgbOfInt(c)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
  return (f(r) << 16) | (f(g) << 8) | f(b)
}

/** hash inteiro barato e determinístico (para variar sem Math.random) */
export function hash2(a: number, b = 0, c = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return h >>> 0
}
export const hash01 = (a: number, b = 0, c = 0): number => hash2(a, b, c) / 4294967296

export class Buf {
  readonly data: Uint8ClampedArray
  constructor(
    readonly w: number,
    readonly h: number
  ) {
    this.data = new Uint8ClampedArray(w * h * 4)
  }

  clear(): void {
    this.data.fill(0)
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h
  }

  /** escreve o pixel (substitui, inclusive o alfa) */
  set(x: number, y: number, c: number, a = 255): void {
    x |= 0
    y |= 0
    if (!this.inside(x, y)) return
    const o = (y * this.w + x) * 4
    this.data[o] = (c >> 16) & 255
    this.data[o + 1] = (c >> 8) & 255
    this.data[o + 2] = c & 255
    this.data[o + 3] = a
  }

  /** mistura por cima (alfa 0..255) */
  blend(x: number, y: number, c: number, a: number): void {
    x |= 0
    y |= 0
    if (!this.inside(x, y) || a <= 0) return
    const o = (y * this.w + x) * 4
    const da = this.data[o + 3]!
    if (a >= 255 || da === 0) {
      this.set(x, y, c, Math.max(a, 0))
      if (da === 0 && a < 255) this.data[o + 3] = a
      return
    }
    const sa = a / 255
    const oa = sa + (da / 255) * (1 - sa)
    const r = (((c >> 16) & 255) * sa + this.data[o]! * (da / 255) * (1 - sa)) / oa
    const g = (((c >> 8) & 255) * sa + this.data[o + 1]! * (da / 255) * (1 - sa)) / oa
    const b = ((c & 255) * sa + this.data[o + 2]! * (da / 255) * (1 - sa)) / oa
    this.data[o] = r
    this.data[o + 1] = g
    this.data[o + 2] = b
    this.data[o + 3] = Math.round(oa * 255)
  }

  /** 0xRRGGBB do pixel (sem alfa) */
  get(x: number, y: number): number {
    x |= 0
    y |= 0
    if (!this.inside(x, y)) return 0
    const o = (y * this.w + x) * 4
    return (this.data[o]! << 16) | (this.data[o + 1]! << 8) | this.data[o + 2]!
  }

  alpha(x: number, y: number): number {
    x |= 0
    y |= 0
    return this.inside(x, y) ? this.data[(y * this.w + x) * 4 + 3]! : 0
  }

  rect(x: number, y: number, w: number, h: number, c: number, a = 255): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, a)
  }

  blendRect(x: number, y: number, w: number, h: number, c: number, a: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.blend(x + i, y + j, c, a)
  }

  /** apaga (alfa 0) um retângulo: o "buraco" da janela */
  hole(x: number, y: number, w: number, h: number): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const xx = x + i
        const yy = y + j
        if (this.inside(xx, yy)) this.data[(yy * this.w + xx) * 4 + 3] = 0
      }
  }

  hline(x: number, y: number, w: number, c: number, a = 255): void {
    this.rect(x, y, w, 1, c, a)
  }
  vline(x: number, y: number, h: number, c: number, a = 255): void {
    this.rect(x, y, 1, h, c, a)
  }

  /** Bresenham */
  line(x0: number, y0: number, x1: number, y1: number, c: number, a = 255): void {
    x0 = Math.round(x0)
    y0 = Math.round(y0)
    x1 = Math.round(x1)
    y1 = Math.round(y1)
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      this.set(x0, y0, c, a)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x0 += sx
      }
      if (e2 <= dx) {
        err += dx
        y0 += sy
      }
    }
  }

  /** elipse cheia; devolve nada. `blendA` < 255 mistura em vez de substituir */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: number, a = 255): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx
        const ny = (y + 0.5 - cy) / ry
        if (nx * nx + ny * ny <= 1) a >= 255 ? this.set(x, y, c) : this.blend(x, y, c, a)
      }
  }

  /**
   * Pontilhado entre duas cores: `level` 0 = só `c1`, 1 = só `c2`. Passe `c1 = -1` para pintar só os pontos de c2
   * (o resto fica como está) e `c2 = -1` para pintar só os pontos de c1.
   */
  dither(x: number, y: number, w: number, h: number, c1: number, c2: number, level: number): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const on = level > bayer(x + i, y + j)
        const c = on ? c2 : c1
        if (c >= 0) this.set(x + i, y + j, c)
      }
  }

  /** pontilhado de transparência: pinta `c` com alfa `a` nos pontos em que `level` passa do limiar de Bayer */
  ditherA(x: number, y: number, w: number, h: number, c: number, level: number, a = 255): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (level > bayer(x + i, y + j)) this.blend(x + i, y + j, c, a)
  }

  /** copia `src` para cá em (x,y), misturando pelo alfa; `alpha` 0..1 multiplica */
  blit(src: Buf, x: number, y: number, alpha = 1, flipX = false): void {
    for (let j = 0; j < src.h; j++) {
      const yy = y + j
      if (yy < 0 || yy >= this.h) continue
      for (let i = 0; i < src.w; i++) {
        const xx = x + i
        if (xx < 0 || xx >= this.w) continue
        const so = (j * src.w + (flipX ? src.w - 1 - i : i)) * 4
        const sa = src.data[so + 3]!
        if (sa === 0) continue
        const c = (src.data[so]! << 16) | (src.data[so + 1]! << 8) | src.data[so + 2]!
        this.blend(xx, yy, c, Math.round(sa * alpha))
      }
    }
  }

  clone(): Buf {
    const b = new Buf(this.w, this.h)
    b.data.set(this.data)
    return b
  }

  /** ampliação inteira (vizinho mais próximo), para o preview */
  scaled(k: number): Buf {
    const b = new Buf(this.w * k, this.h * k)
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++) {
        const so = (Math.floor(y / k) * this.w + Math.floor(x / k)) * 4
        const o = (y * b.w + x) * 4
        b.data[o] = this.data[so]!
        b.data[o + 1] = this.data[so + 1]!
        b.data[o + 2] = this.data[so + 2]!
        b.data[o + 3] = this.data[so + 3]!
      }
    return b
  }
}

/** linhas de letras -> Buf, com a paleta dada (`.` e letras fora da paleta ficam transparentes) */
export function rowsToBuf(rows: readonly string[], pal: Record<string, string>): Buf {
  const b = new Buf(rows[0]!.length, rows.length)
  rows.forEach((line, y) =>
    [...line].forEach((ch, x) => {
      if (ch === '.' || ch === ' ') return
      const c = pal[ch]
      if (c) b.set(x, y, hexToInt(c))
    })
  )
  return b
}
