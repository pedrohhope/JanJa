import { describe, expect, it } from 'vitest'
import { createRace, hitsWall, step } from '../../src/shared/games/race/sim'
import { gridSpot, tileAt, TRACK_DEFS, TRACKS } from '../../src/shared/games/race/tracks'
import { BOT_SLOT_BASE, CAR_R, MAX_BOTS, MAX_HUMANS, TRACK_IDS, type BotLevel } from '../../src/shared/games/race/types'

const onRoad = (c: string) => c === '.' || c === '=' || c === '>'

describe('pistas da corrida', () => {
  for (const id of TRACK_IDS) {
    const t = TRACKS[id]
    describe(t.def.name, () => {
      it('o traçado inteiro (pontos e o meio de cada trecho) passa só por pista', () => {
        for (let i = 0; i < t.wps.length; i++) {
          const a = t.wps[i]!
          const b = t.wps[(i + 1) % t.wps.length]!
          for (const f of [0, 0.25, 0.5, 0.75]) {
            const x = a.x + (b.x - a.x) * f
            const y = a.y + (b.y - a.y) * f
            expect(onRoad(tileAt(t, x, y)), `${id} ponto ${i}+${f}`).toBe(true)
            expect(hitsWall(t, x, y)).toBe(false)
          }
        }
      })

      it('o grid de largada cabe atrás da linha, na pista, para todo mundo', () => {
        for (let i = 0; i < MAX_HUMANS + MAX_BOTS; i++) {
          const g = gridSpot(t, i)
          expect(onRoad(tileAt(t, g.x, g.y)), `vaga ${i}`).toBe(true)
          expect(hitsWall(t, g.x, g.y)).toBe(false)
          for (let j = 0; j < i; j++) {
            const o = gridSpot(t, j)
            expect(Math.hypot(o.x - g.x, o.y - g.y)).toBeGreaterThan(CAR_R * 2)
          }
          // atrás da linha de chegada
          const s = t.wps[0]!
          expect((g.x - s.x) * s.dx + (g.y - s.y) * s.dy).toBeLessThan(0)
        }
      })

      it('tem linha de chegada, turbos e muro na borda', () => {
        expect(t.grid.filter((c) => c === '=').length).toBeGreaterThan(10)
        expect(t.grid.filter((c) => c === '>').length).toBeGreaterThanOrEqual(TRACK_DEFS[id].boosts.length * 32)
        for (let i = 0; i < t.w; i++) {
          expect(t.grid[i]).toBe('#')
          expect(t.grid[(t.h - 1) * t.w + i]).toBe('#')
        }
        expect(t.wps.length).toBeLessThan(256) // o índice vai em u8 no retrato
      })

      for (const level of ['facil', 'dificil'] as BotLevel[]) {
        it(`robôs (${level}) completam as voltas sem atravessar muro`, () => {
          const refs = Array.from({ length: MAX_BOTS }, (_, i) => ({ slot: BOT_SLOT_BASE + i, id: `b${i}`, bot: true }))
          const s = createRace(refs, { trackId: id, laps: 2, botLevel: level })
          while (s.phase !== 'fim' && s.tick < 60 * 200) {
            step(s, new Map())
            for (const c of s.cars) expect(hitsWall(t, c.x, c.y, CAR_R - 1.5), `${c.slot} no tick ${s.tick}`).toBe(false)
          }
          expect(s.phase).toBe('fim')
          expect(s.cars.every((c) => c.finishTick > 0)).toBe(true)
        })
      }
    })
  }
})
