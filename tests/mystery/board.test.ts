import { describe, expect, it } from 'vitest'
import { DOORS, distances, H, isRoom, MAP, RECTS, reachable, ROOM_OF, START, W } from '../../src/shared/games/mystery/board'
import { PLACES } from '../../src/shared/games/mystery/cards'

describe('tabuleiro do Mistério', () => {
  it('mapa retangular, só com símbolos da legenda', () => {
    for (const row of MAP) expect(row).toHaveLength(W)
    expect(MAP).toHaveLength(H)
    for (const ch of MAP.join('')) expect(ch === '.' || ch === '#' || !!ROOM_OF[ch.toUpperCase()], ch).toBe(true)
  })

  it('cada lugar das cartas é um cômodo retangular com porta, e o Saguão também', () => {
    const rooms = RECTS.map((r) => r.room).sort()
    expect(rooms).toEqual([...PLACES.map((p) => p.id), START].sort())
    for (const r of RECTS) {
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) expect(ROOM_OF[MAP[y][x].toUpperCase()], `${r.room} ${x},${y}`).toBe(r.room)
      expect(DOORS.some((d) => d.room === r.room), r.room).toBe(true)
    }
  })

  it('do Saguão dá para chegar em todos os lugares, e nenhum fica longe demais', () => {
    const d = distances(START)
    for (const p of PLACES) {
      expect(d.get(p.id), p.id).toBeDefined()
      expect(d.get(p.id)!).toBeLessThanOrEqual(12)
    }
  })

  it('anda até a soma dos dados, nunca mais, e para ao entrar num cômodo', () => {
    for (const from of [START, 'cozinha', '10,4', '0,4']) {
      const d = distances(from)
      for (const steps of [2, 5, 12]) {
        const r = reachable(from, steps)
        for (const p of r) expect(d.get(p)!).toBeLessThanOrEqual(steps)
        expect(r).not.toContain(from)
      }
    }
    // cômodo não é passagem: do Saguão, para chegar no Porão, não atravessa a Cozinha
    const d = distances(START)
    expect(isRoom('cozinha')).toBe(true)
    expect(d.get('porao')).toBeGreaterThan(0)
  })
})
