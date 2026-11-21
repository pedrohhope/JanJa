/** Armas no chão, projéteis e poça: arte em letras (mesma paleta). Os projéteis olham para a direita; a cena espelha. */
import type { ProjectileKind, WeaponId } from '../../../../shared/games/brawl/types'
import { G, type Rows } from './grid'
import { drawWeapon } from './weapons'

/** arma solta (24x24 cortado de uma grade de 32): `deg` é o ângulo que ela aponta */
export function weaponRows(w: WeaponId, deg = 315): Rows {
  const g = new G()
  drawWeapon(g, w, 10, 22, deg, 0)
  // recorta a faixa útil e põe contorno escuro
  const rows = g.rows()
  const out = rows.map((line, y) =>
    [...line]
      .map((c, x) => {
        if (c !== '.') return c
        const n = (xx: number, yy: number) => (rows[yy]?.[xx] ?? '.') !== '.'
        return n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1) ? 'k' : '.'
      })
      .join('')
  )
  return out
}
export const ITEM_SIZE = 32
/** onde fica o centro da arma na grade (para o pivô de giro) */
export const ITEM_PIVOT = { x: 16, y: 16 }

export const PROJECTILE_ART: Record<Exclude<ProjectileKind, 'arma'>, Rows[]> = {
  carta: [
    ['.kkkkk.', 'kpppppk', 'kpKppok', 'kpppppk', 'kppKppk', 'kpppppk', 'kpppKpk', '.kkkkk.'],
    ['..kkk..', '.kppok.', '.kKppk.', '.kpppk.', '.kppKk.', '.kpppk.', '..kkk..']
  ],
  wifi: [
    ['.......g..', '.....gg.g..', '....g....g.', '...g..g..g.', '..g..g...g.', '..g..g...g.', '...g..g..g.', '....g....g.', '.....gg.g..', '.......g...'],
    ['........u..', '.....uuu.u..', '....u....u..', '...u..u...u.', '..u..u....u.', '..u..u....u.', '...u..u...u.', '....u....u..', '.....uuu.u..', '........u...']
  ],
  vapor: [
    ['..ppp..', '.ppppp.', 'pppdppp', 'ppppppp', '.pppdp.', '..ddd..'],
    ['..dpp..', '.pppppp', 'ppdpppp', 'pppppdp', '.ppppp.', '..pdd..']
  ],
  raio: [
    ['....uu..', '...uy...', '..uyy...', '.uuuuuu.', '...yyu..', '...yu...', '..uy....', '..u.....'],
    ['..uu....', '...yu...', '...yyu..', '.uuuuuu.', '..uyy...', '...uy...', '....yu..', '.....u..']
  ],
  onda: [
    ['..uu..', '.u..u.', 'u....u', 'u....u', 'u....u', '.u..u.', '..uu..'],
    ['..pp..', '.p..p.', 'p....p', 'p....p', 'p....p', '.p..p.', '..pp..']
  ]
}

/** poça de café vista de lado: elipse achatada de largura `w` (px) em Rows, com borda e brilho */
export function puddleRows(w: number): Rows {
  const h = 4
  const rows: string[][] = Array.from({ length: h }, () => Array<string>(w).fill('.'))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - w / 2) / (w / 2)
      const ny = (y + 0.5 - h / 2) / (h / 2)
      const d = nx * nx + ny * ny
      if (d > 1) continue
      rows[y]![x] = d > 0.7 ? 'n' : y === 1 && x % 5 === 2 ? 'M' : 'm'
    }
  return rows.map((r) => r.join(''))
}
