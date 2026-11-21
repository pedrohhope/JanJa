import { describe, expect, it } from 'vitest'
import { ARENAS } from '../../src/shared/games/brawl/arenas'
import { CHARACTERS } from '../../src/shared/games/brawl/characters'
import { brawlSim } from '../../src/shared/games/brawl/sim'
import { BTN_JUMP, BTN_LIGHT, COUNTDOWN_TICKS, MAX_DAMAGE, type BrawlInput, type BrawlSimState } from '../../src/shared/games/brawl/types'
import { bots, humans, lcg, make, randomInputs, resetRandomSeq, skipCountdown, stepN } from './helpers'

function finite(s: BrawlSimState): boolean {
  const ok = (v: number) => Number.isFinite(v)
  for (const f of s.fighters) if (![f.x, f.y, f.vx, f.vy, f.damage, f.stocks].every(ok)) return false
  for (const p of s.projectiles) if (![p.x, p.y, p.vx, p.vy].every(ok)) return false
  for (const i of s.items) if (![i.x, i.y].every(ok)) return false
  return ok(s.rng) && ok(s.tick)
}

function overlapsSolid(s: BrawlSimState): string | null {
  const arena = ARENAS[s.arenaId]
  for (const f of s.fighters) {
    if (f.away || f.action === 'fora' || f.action === 'eliminado') continue
    const sp = CHARACTERS[f.char]
    for (const p of arena.platforms) {
      if (p.thin) continue
      // folga de 1e-6 por causa de ponto flutuante
      if (f.x + sp.hurtW / 2 > p.x + 1e-6 && f.x - sp.hurtW / 2 < p.x + p.w - 1e-6 && f.y > p.y + 1e-6 && f.y - sp.hurtH < p.y + p.h - 1e-6) return `slot ${f.slot} em (${f.x}, ${f.y}) dentro de ${p.art}`
    }
  }
  return null
}

function play(arenaId: 'estante' | 'telhado', seed: number, ticks: number, level: 'facil' | 'medio' | 'dificil' = 'medio'): BrawlSimState {
  resetRandomSeq()
  const s = make([...humans(3), ...bots(2)], { arenaId, mode: 'tempo', minutes: 2, botLevel: level }, seed)
  const rnd = lcg(seed * 31 + 1)
  for (let i = 0; i < ticks; i++) {
    brawlSim.step(s, randomInputs(s, rnd))
    if (i % 3 === 0) {
      expect(finite(s)).toBe(true)
      const bad = overlapsSolid(s)
      if (bad) throw new Error(`tick ${s.tick}: ${bad}`)
    }
  }
  return s
}

describe('propriedades', () => {
  for (const arenaId of ['estante', 'telhado'] as const) {
    it(`milhares de ticks (${arenaId}): ninguém dentro de plataforma sólida, tudo finito, limites respeitados`, () => {
      for (const seed of [1, 2, 3]) {
        const s = play(arenaId, seed, 4000)
        for (const f of s.fighters) {
          expect(f.damage).toBeGreaterThanOrEqual(0)
          expect(f.damage).toBeLessThanOrEqual(MAX_DAMAGE)
          expect(f.jumpsLeft).toBeGreaterThanOrEqual(0)
          expect(f.jumpsLeft).toBeLessThanOrEqual(3)
          expect(f.kos).toBeGreaterThanOrEqual(0)
        }
        expect(s.items.length).toBeLessThanOrEqual(8)
      }
    })
  }

  it('dano só sobe e vidas só descem entre nocautes (partida de robôs)', () => {
    const s = make([...bots(4)], { botLevel: 'dificil' }, 11)
    const lastDmg = new Map<number, number>()
    const lastStocks = new Map<number, number>()
    for (let i = 0; i < 12000 && s.phase !== 'fim'; i++) {
      const evs = brawlSim.step(s, new Map())
      const kos = new Set(evs.filter((e) => e.type === 'ko').map((e) => (e as { victim: number }).victim))
      for (const f of s.fighters) {
        const d = lastDmg.get(f.slot) ?? 0
        if (!kos.has(f.slot)) expect(f.damage).toBeGreaterThanOrEqual(d)
        lastDmg.set(f.slot, f.damage)
        const st = lastStocks.get(f.slot) ?? f.stocks
        expect(f.stocks).toBeLessThanOrEqual(st)
        lastStocks.set(f.slot, f.stocks)
      }
    }
  })

  it('determinismo: mesma semente e mesmas entradas dão o mesmo estado', () => {
    const run = () => JSON.stringify(play('estante', 5, 3000, 'dificil'))
    expect(run()).toBe(run())
    expect(JSON.stringify(play('estante', 6, 3000))).not.toBe(run())
  })

  it('clone + step igual ao original', () => {
    resetRandomSeq()
    const s = make([...humans(2), ...bots(2)], { mode: 'tempo' }, 9)
    const rnd = lcg(77)
    for (let i = 0; i < 1500; i++) brawlSim.step(s, randomInputs(s, rnd))
    const c = brawlSim.cloneState(s)
    expect(JSON.stringify(c)).toBe(JSON.stringify(s))
    const rnd2 = lcg(5)
    const rnd3 = lcg(5)
    const seqA = new Map<number, number>()
    for (let i = 0; i < 800; i++) {
      // mesmas entradas para os dois (seq crescente, a partir do que o estado já viu)
      const inA = new Map<number, BrawlInput>()
      for (const f of s.fighters) if (!f.bot) inA.set(f.slot, { seq: f.lastSeq + 1, mx: Math.floor(rnd2() * 3) - 1, my: 0, buttons: rnd2() < 0.1 ? BTN_LIGHT : rnd2() < 0.1 ? BTN_JUMP : 0 })
      const inB = new Map<number, BrawlInput>()
      for (const f of c.fighters) if (!f.bot) inB.set(f.slot, { seq: f.lastSeq + 1, mx: Math.floor(rnd3() * 3) - 1, my: 0, buttons: rnd3() < 0.1 ? BTN_LIGHT : rnd3() < 0.1 ? BTN_JUMP : 0 })
      void seqA
      const ea = brawlSim.step(s, inA)
      const eb = brawlSim.step(c, inB)
      expect(JSON.stringify(eb)).toBe(JSON.stringify(ea))
    }
    expect(JSON.stringify(c)).toBe(JSON.stringify(s))
    // o clone é independente
    c.fighters[0].x += 50
    expect(s.fighters[0].x).not.toBe(c.fighters[0].x)
  })

  it('partida inteira só de robôs termina (tempo) com ranking coerente', () => {
    const s = make(bots(4), { mode: 'tempo', minutes: 2, botLevel: 'dificil' }, 3)
    for (let i = 0; i < COUNTDOWN_TICKS + 2 * 3600 + 3600 * 3 && s.phase !== 'fim'; i++) brawlSim.step(s, new Map())
    expect(s.phase).toBe('fim')
    const r = brawlSim.ranking(s)
    expect(r).toHaveLength(4)
    for (let i = 1; i < r.length; i++) expect(r[i - 1].kos - r[i - 1].falls).toBeGreaterThanOrEqual(r[i].kos - r[i].falls)
  })
})

describe('predictSelf', () => {
  it('bate com o step quando ninguém interfere', () => {
    resetRandomSeq()
    for (const char of ['jan', 'xicara', 'teve', 'janja'] as const) {
      const a = make(humans(1, [char]), { stocks: 5 }, 4)
      skipCountdown(a)
      const b = brawlSim.cloneState(a)
      const rnd = lcg(char.length * 99)
      let n = 0
      for (let i = 0; i < 1500; i++) {
        const inp = randomInputs(a, rnd, true)
        const evs = brawlSim.step(a, inp)
        brawlSim.predictSelf(b, 0, inp.get(0)!)
        b.tick++
        if (evs.some((e) => e.type === 'ko' || e.type === 'respawn')) {
          // nocaute e renascer são do step (o cliente recebe pelo snapshot): ressincroniza
          b.fighters[0] = brawlSim.cloneState(a).fighters[0]
          continue
        }
        const fa = a.fighters[0]
        const fb = b.fighters[0]
        for (const k of ['x', 'y', 'vx', 'vy', 'facing', 'action', 'actionTick', 'move', 'moveTick', 'charge', 'jumpsLeft', 'grounded', 'wallSide', 'invulnUntil', 'dodgeReadyTick', 'recoveryUsed', 'airDodgeUsed', 'fastFall', 'lastSeq'] as const) {
          expect(fb[k], `${char} tick ${i} campo ${k}`).toEqual(fa[k])
        }
        n++
      }
      expect(n).toBeGreaterThan(900)
    }
  })

  it('não mexe no rng nem nos outros lutadores', () => {
    const s = make([...humans(2), ...bots(1)])
    skipCountdown(s)
    const before = JSON.stringify({ rng: s.rng, others: s.fighters.slice(1), items: s.items, projectiles: s.projectiles })
    const rng0 = s.rng
    for (let i = 0; i < 50; i++) {
      brawlSim.predictSelf(s, 0, { seq: i + 1, mx: 1, my: 0, buttons: i % 7 === 0 ? BTN_LIGHT : BTN_JUMP })
      s.tick++
    }
    expect(s.rng).toBe(rng0)
    const after = JSON.stringify({ rng: s.rng, others: s.fighters.slice(1), items: s.items, projectiles: s.projectiles })
    expect(after).toBe(before)
    stepN(s, 0)
  })
})
