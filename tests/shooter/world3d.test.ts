import { describe, expect, it } from 'vitest'
import { LEGEND, MAPS } from '../../src/shared/games/shooter/maps'
import { tileAt } from '../../src/shared/games/shooter/maps/legend'
import type { MapDef } from '../../src/shared/games/shooter/types'
import { SPAL_KEYS } from '../../src/web/game/shooter/scene/palette'
import { HAS_CEILING, MAX_WORLD_LIGHTS, SHOT_H, WALL_H, type MeshData, type World3D } from '../../src/web/game/shooter/scene3d/contract3d'
import { PROP_3D, capRows, ceilingRows, propHeight, sideRows, waterRows } from '../../src/web/game/shooter/scene3d/props3d'
import { buildWorld } from '../../src/web/game/shooter/scene3d/world'

const layerEntries = (l: World3D['layers']): [string, MeshData][] => Object.entries(l).filter((e): e is [string, MeshData] => !!e[1])
const arts = [...new Set(Object.values(LEGEND).map((t) => t.art))]
const maps: MapDef[] = Object.values(MAPS) as MapDef[]

describe('props3d', () => {
  it('toda art da LEGEND tem PROP_3D', () => {
    for (const a of arts) expect(PROP_3D[a], a).toBeDefined()
    for (const a of ['piso-madeira', 'piso-ceramica', 'tapete', 'grama', 'terra', 'agua']) expect(PROP_3D[a]!.shape).toBe('flat')
    expect(PROP_3D.parede!.shape).toBe('wall')
  })

  it('altura x blocksShot', () => {
    for (const t of Object.values(LEGEND)) {
      const p = PROP_3D[t.art]!
      if (p.shape === 'flat' || p.shape === 'wall' || !t.solid) continue
      if (t.blocksShot) expect(p.height, t.art).toBeGreaterThan(SHOT_H)
      else expect(p.height, t.art).toBeLessThan(SHOT_H)
    }
  })

  it('sideRows: 16 de largura, altura certa e só letras da paleta', () => {
    for (const mapId of ['casa', 'quintal'] as const)
      for (const a of arts) {
        const rows = sideRows(a, mapId)
        const flat = PROP_3D[a]!.shape === 'flat'
        expect(rows.length, `${a} ${mapId}`).toBe(flat ? 1 : Math.round(16 * propHeight(a, mapId)))
        for (const r of rows) {
          expect(r.length).toBe(16)
          for (const ch of r) expect(SPAL_KEYS.has(ch), `${a}: "${ch}"`).toBe(true)
        }
        // lateral é opaca (sem pixel transparente)
        if (!flat) for (const r of rows) expect(r.includes('.'), `${a} tem pixel transparente`).toBe(false)
      }
    expect(sideRows('parede', 'casa').length).toBe(Math.round(16 * WALL_H.casa))
    expect(sideRows('parede', 'quintal').length).toBe(Math.round(16 * WALL_H.quintal))
  })

  it('teto, água e tampa são 16x16 válidos', () => {
    for (const rows of [ceilingRows(), waterRows(), capRows()]) {
      expect(rows.length).toBe(16)
      for (const r of rows) {
        expect(r.length).toBe(16)
        for (const ch of r) expect(SPAL_KEYS.has(ch) && ch !== '.').toBe(true)
      }
    }
  })
})

describe.each(maps)('buildWorld $id', (map) => {
  const world = buildWorld(map)
  const wallH = WALL_H[map.id]

  it('arrays consistentes, sem NaN e tudo dentro do mapa', () => {
    expect(world.w).toBe(map.w)
    expect(world.h).toBe(map.h)
    expect(Object.keys(world.layers).length).toBeGreaterThan(3)
    for (const [key, m] of layerEntries(world.layers)) {
      const n = m.pos.length / 3
      expect(n % 3, key).toBe(0)
      expect(m.nrm.length, key).toBe(3 * n)
      expect(m.uv.length, key).toBe(2 * n)
      expect(m.col.length, key).toBe(3 * n)
      const eps = 1e-4
      const tall = key === 'leaves' || key === 'trunk' ? 8 : Math.max(wallH, 3.4) + 0.01
      for (const arr of [m.pos, m.nrm, m.uv, m.col]) for (const v of arr) expect(Number.isFinite(v), key).toBe(true)
      for (let i = 0; i < m.pos.length; i += 3) {
        expect(m.pos[i]!).toBeGreaterThanOrEqual(-eps)
        expect(m.pos[i]!).toBeLessThanOrEqual(map.w + eps)
        expect(m.pos[i + 2]!).toBeGreaterThanOrEqual(-eps)
        expect(m.pos[i + 2]!).toBeLessThanOrEqual(map.h + eps)
        expect(m.pos[i + 1]!, key).toBeGreaterThanOrEqual(key === 'water' ? -0.1 : -eps)
        expect(m.pos[i + 1]!, key).toBeLessThanOrEqual(tall)
      }
      for (let i = 0; i < m.col.length; i++) {
        expect(m.col[i]!).toBeGreaterThanOrEqual(0)
        expect(m.col[i]!).toBeLessThanOrEqual(1.0001)
      }
    }
  })

  it('normais unitárias e coerentes com a ordem dos triângulos', () => {
    for (const [key, m] of layerEntries(world.layers)) {
      for (let t = 0; t < m.pos.length / 9; t++) {
        const o = t * 9
        const a = [m.pos[o]!, m.pos[o + 1]!, m.pos[o + 2]!]
        const b = [m.pos[o + 3]!, m.pos[o + 4]!, m.pos[o + 5]!]
        const c = [m.pos[o + 6]!, m.pos[o + 7]!, m.pos[o + 8]!]
        const nx = m.nrm[o]!
        const ny = m.nrm[o + 1]!
        const nz = m.nrm[o + 2]!
        expect(Math.abs(Math.hypot(nx, ny, nz) - 1), key).toBeLessThan(1e-5)
        const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
        const e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
        const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!]
        expect(cr[0]! * nx + cr[1]! * ny + cr[2]! * nz, `${key} triângulo ${t}`).toBeGreaterThan(0)
      }
    }
  })

  it('só faces expostas da parede', () => {
    let edges = 0
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        if (tileAt(map, x, y).art !== 'parede') continue
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue
          if (tileAt(map, nx, ny).art !== 'parede') edges++
        }
      }
    const side = world.layers['side:parede']
    expect(side).toBeDefined()
    expect(side!.pos.length / 9 / 2).toBe(edges)
  })

  it('luzes limitadas e dentro do mapa', () => {
    expect(world.lights.length).toBeGreaterThan(0)
    expect(world.lights.length).toBeLessThanOrEqual(MAX_WORLD_LIGHTS)
    for (const l of world.lights) {
      expect(l.x).toBeGreaterThan(0)
      expect(l.x).toBeLessThan(map.w)
      expect(l.z).toBeGreaterThan(0)
      expect(l.z).toBeLessThan(map.h)
      expect(l.power).toBeGreaterThan(0)
      expect(l.range).toBeGreaterThan(0)
    }
  })

  it('teto só na casa, água só no quintal', () => {
    expect(!!world.layers.ceiling).toBe(HAS_CEILING[map.id])
    expect(!!world.layers.water).toBe(map.id === 'quintal')
    expect(!!world.layers.floor).toBe(true)
    expect(!!world.layers.top).toBe(true)
  })

  it('é determinístico', () => {
    const again = buildWorld(map)
    expect(Object.keys(again.layers)).toEqual(Object.keys(world.layers))
    for (const k of Object.keys(world.layers) as (keyof typeof world.layers)[]) expect(again.layers[k]!.pos).toEqual(world.layers[k]!.pos)
    expect(again.lights).toEqual(world.lights)
  })
})

describe('buildWorld: camadas por mapa', () => {
  it('casa tem glow da TV; quintal tem árvore, varal e brasa', () => {
    const casa = buildWorld(MAPS.casa as MapDef)
    expect(casa.layers.glow).toBeDefined()
    expect(casa.layers['side:tv']).toBeDefined()
    const q = buildWorld(MAPS.quintal as MapDef)
    for (const k of ['trunk', 'leaves', 'line', 'glow', 'water', 'side:parede', 'side:mureta', 'side:cerca'] as const) expect(q.layers[k], k).toBeDefined()
  })
})
