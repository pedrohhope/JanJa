/**
 * Grade de letras 32x32 para compor os quadros dos lutadores (corpo base + braços/arma por pose).
 * `.` é transparente. O contorno (`t`, a tinta do jogador) é gerado por `outline` em volta do corpo e da arma.
 */
export const FW = 32
export const FH = 32
/** coluna do centro do corpo (o pivô horizontal do sprite) */
export const AX = 10
/** última linha com conteúdo (os pés); a linha de baixo é só contorno */
export const FEET = 30

export type Rows = string[]

export class G {
  readonly c: string[][] = Array.from({ length: FH }, () => Array<string>(FW).fill('.'))

  put(x: number, y: number, ch: string): this {
    x = Math.round(x)
    y = Math.round(y)
    if (ch !== '.' && ch !== ' ' && x >= 0 && y >= 0 && x < FW && y < FH) this.c[y]![x] = ch
    return this
  }
  get(x: number, y: number): string {
    return x >= 0 && y >= 0 && x < FW && y < FH ? this.c[Math.round(y)]![Math.round(x)]! : '.'
  }
  rect(x: number, y: number, w: number, h: number, ch: string): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, ch)
    return this
  }
  /** escreve linhas; `.` e espaço deixam o que já estava */
  stamp(x: number, y: number, rows: readonly string[]): this {
    rows.forEach((line, j) => [...line].forEach((ch, i) => this.put(x + i, y + j, ch)))
    return this
  }
  /** linha de Bresenham */
  line(x0: number, y0: number, x1: number, y1: number, ch: string): this {
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
      this.put(x0, y0, ch)
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
    return this
  }
  disc(cx: number, cy: number, r: number, ch: string): this {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.put(x, y, ch)
    return this
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, ch: string): this {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.put(x, y, ch)
    return this
  }
  /** apaga o pixel (transparente) */
  clear(x: number, y: number): this {
    x = Math.round(x)
    y = Math.round(y)
    if (x >= 0 && y >= 0 && x < FW && y < FH) this.c[y]![x] = '.'
    return this
  }
  /** troca uma letra por outra */
  replace(from: string, to: string): this {
    for (const row of this.c) for (let i = 0; i < row.length; i++) if (row[i] === from) row[i] = to
    return this
  }
  rows(): Rows {
    return this.c.map((r) => r.join(''))
  }
}

/** Contorno de 1 px (4 vizinhos) na letra `t`, em volta de tudo que não é transparente. */
export function outline(rows: Rows, ch = 't'): Rows {
  const h = rows.length
  const w = rows[0]!.length
  return rows.map((line, y) =>
    [...line]
      .map((c, x) => {
        if (c !== '.') return c
        const n = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < h && rows[yy]![xx] !== '.'
        return n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1) ? ch : '.'
      })
      .join('')
  )
}

/** espelha horizontalmente (os quadros de golpe e de pose são desenhados para a direita) */
export const flipRows = (rows: Rows): Rows => rows.map((l) => [...l].reverse().join(''))

/** troca todas as letras opacas por `ch` (silhueta, para o pisca branco) */
export const silhouette = (rows: Rows, ch = 'p'): Rows => rows.map((l) => l.replace(/[^.]/g, ch))

/** vetor unitário de um ângulo em graus (0 = direita, 90 = baixo, y cresce para baixo) */
export function dirOf(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180
  return [Math.cos(r), Math.sin(r)]
}
