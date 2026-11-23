/**
 * X e O da Velha ao quadrado em pixel art (7x7), desenhados em código. Sem React: o teste importa daqui.
 * Letras: c cor, s sombra (embaixo e à direita), '.' vazio.
 */
import type { Mark } from '../../../../shared/games/velha/rules'

export const MARK_PX = 7

export const MARK_SPRITES: Record<Mark, string[]> = {
  x: ['cc...cc', 'ccc.ccs', '.ccccs.', '..ccs..', '.ccccs.', 'ccs.ccs', 'cs...cs'],
  o: ['..ccc..', '.cccccs', 'cc...cs', 'cc...cs', 'cc...cs', '.ccccss', '..csss.']
}

/** cor e sombra de cada marca (X no abajur, O no azul) */
export const MARK_COLORS: Record<Mark, { c: string; s: string }> = {
  x: { c: '#FFC94A', s: '#E0A92E' },
  o: { c: '#6FA3C7', s: '#3F6F94' }
}

export interface Run {
  x: number
  y: number
  w: number
  fill: string
}

/** pixels juntos na mesma linha viram um retângulo só */
export function markRuns(m: Mark): Run[] {
  const out: Run[] = []
  MARK_SPRITES[m].forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      if (ch === '.') {
        x++
        continue
      }
      let w = 1
      while (row[x + w] === ch) w++
      out.push({ x, y, w, fill: ch === 'c' ? MARK_COLORS[m].c : MARK_COLORS[m].s })
      x += w
    }
  })
  return out
}
