/** As 3 armas desenhadas na mão (e no chão, ver `items.ts`). Tudo em letras, sem imagem pronta. */
import type { WeaponId } from '../../../../shared/games/brawl/types'
import { G, dirOf } from './grid'

/**
 * Desenha a arma segurada em (gx, gy) apontando para `deg` (0 = frente, 90 = baixo, 270 = cima).
 * `reach` estica o cabo (golpes de estocada).
 */
export function drawWeapon(g: G, w: WeaponId, gx: number, gy: number, deg: number, reach = 0): void {
  const [dx, dy] = dirOf(deg)
  const px = -dy
  const py = dx
  const at = (t: number, s = 0) => [gx + dx * t + px * s, gy + dy * t + py * s] as const
  if (w === 'vassoura') {
    const L = 6 + reach
    for (let t = -3; t <= L; t++) {
      const [x, y] = at(t)
      g.put(x, y, t % 4 === 1 ? 'M' : 'N')
    }
    // fita vermelha e cerdas de palha
    const [bx, by] = at(L)
    g.put(bx, by, 'o')
    for (let a = 1; a <= 5; a++) {
      const half = 1 + Math.round(a * 0.5)
      for (let j = -half; j <= half; j++) {
        const [x, y] = at(L + a, j)
        const edge = Math.abs(j) === half
        g.put(x, y, edge ? 'Q' : a === 1 ? 'y' : (a + j) % 3 === 0 ? 'Y' : 'A')
      }
    }
  } else if (w === 'frigideira') {
    const L = 4 + reach
    for (let t = -2; t <= L; t++) {
      const [x, y] = at(t)
      g.put(x, y, t === -2 ? 'M' : t < 2 ? 'k' : 'D')
    }
    const [cx, cy] = at(L + 3.5)
    g.disc(cx, cy, 3.7, 'i')
    g.disc(cx, cy, 2.6, 'r')
    g.put(cx - 1, cy - 1, 'I')
    g.put(cx - 2, cy, 'I')
    g.put(cx + 1, cy + 1, 'e')
    // brilho do metal na borda
    const [rx, ry] = at(L + 1)
    g.put(rx, ry, 'I')
  }
}

/** luva de cozinha (borracha azul) no punho: o punho em (hx,hy) e o antebraço vindo de (ax,ay) */
export function drawGlove(g: G, hx: number, hy: number, ax: number, ay: number, big = false): void {
  const r = big ? 2.6 : 2.1
  // punhos de borracha: cano mais claro perto do braço
  const len = Math.hypot(hx - ax, hy - ay) || 1
  const ux = (hx - ax) / len
  const uy = (hy - ay) / len
  g.line(hx - ux * 2, hy - uy * 2, hx - ux * 3.5, hy - uy * 3.5, 'C')
  g.disc(hx - ux * 2.5, hy - uy * 2.5, 1.6, 'C')
  g.disc(hx + 0.5, hy + 0.5, r, 'c')
  g.put(hx - 0.5, hy - 1, 'a')
  g.put(hx + 1.5, hy + 1.5, 'C')
  // dedos
  g.put(hx + Math.round(ux * 2.5), hy + Math.round(uy * 2.5) + 0, 'c')
}
