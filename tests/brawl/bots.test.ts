import { describe, expect, it } from 'vitest'
import { ARENAS } from '../../src/shared/games/brawl/arenas'
import { brawlSim } from '../../src/shared/games/brawl/sim'
import { BTN_MASK, EMPTY_BRAWL_INPUT, type BotLevel, type BrawlSimEvent } from '../../src/shared/games/brawl/types'
import { bots, fighter, humans, make, skipCountdown, stand, stepN } from './helpers'

const MAX_TICKS = 60 * 60 * 10

function match(level: BotLevel, arenaId: 'estante' | 'telhado', seed: number) {
  const s = make(bots(4), { arenaId, botLevel: level, stocks: 3 }, seed)
  let ko = 0
  let self = 0
  let i = 0
  for (; i < MAX_TICKS && s.phase !== 'fim'; i++) {
    for (const e of brawlSim.step(s, new Map())) if (e.type === 'ko') (ko++, e.killer < 0 && self++)
  }
  return { s, ko, self, ticks: i }
}

describe('robôs', () => {
  it('4 robôs difíceis terminam uma partida de vidas sem travar (nas duas arenas)', () => {
    for (const arenaId of ['estante', 'telhado'] as const) {
      for (const seed of [1, 2, 3]) {
        const { s, ticks } = match('dificil', arenaId, seed)
        expect(s.phase, `${arenaId} semente ${seed}`).toBe('fim')
        expect(ticks).toBeLessThan(MAX_TICKS)
        const r = brawlSim.ranking(s)
        expect(r[0].stocks).toBeGreaterThan(0)
        expect(r[0].outTick).toBe(0)
        expect(r.filter((l) => l.outTick === 0)).toHaveLength(1)
      }
    }
  })

  it('fácil e médio também terminam', () => {
    for (const level of ['facil', 'medio'] as const) {
      const { s } = match(level, 'estante', 4)
      expect(s.phase, level).toBe('fim')
    }
  })

  it('robô não se joga para fora sozinho com frequência', () => {
    let ko = 0
    let self = 0
    for (const level of ['facil', 'medio', 'dificil'] as const) {
      for (const arenaId of ['estante', 'telhado'] as const) {
        const m = match(level, arenaId, 21)
        ko += m.ko
        self += m.self
      }
    }
    expect(ko).toBeGreaterThan(30)
    expect(self / ko).toBeLessThan(0.1)
  })

  it('robô fora do palco volta (usa pulos e a recuperação)', () => {
    for (const arenaId of ['estante', 'telhado'] as const) {
      const s = make(bots(1), { arenaId, botLevel: 'dificil' }, 5)
      skipCountdown(s)
      const f = fighter(s, 8)
      const stage = ARENAS[arenaId].platforms[0]
      // lado esquerdo, abaixo do topo do palco, com todos os pulos
      f.x = stage.x - 50
      f.y = stage.y + 40
      f.vx = 0
      f.vy = 0
      f.grounded = false
      const evs: BrawlSimEvent[] = []
      let back = false
      for (let i = 0; i < 240; i++) {
        evs.push(...brawlSim.step(s, new Map()))
        if (f.grounded && f.x > stage.x && f.x < stage.x + stage.w) {
          back = true
          break
        }
        if (f.action === 'fora') break
      }
      expect(back, arenaId).toBe(true)
      expect(evs.some((e) => e.type === 'ko')).toBe(false)
    }
  })

  it('robô pega a arma que gosta e usa golpe forte quando o alvo tem muito dano', () => {
    const s = make([...bots(1, ['teve']), ...humans(1)], { botLevel: 'dificil' }, 2)
    skipCountdown(s)
    const bot = fighter(s, 8)
    const hum = fighter(s, 0)
    stand(bot, 200, 188)
    stand(hum, 300, 188)
    s.items.push({ id: 50, weapon: 'frigideira', x: 220, y: 188, vx: 0, vy: 0, state: 'chao', owner: -1, dieTick: s.tick + 2000 })
    stepN(s, 120, () => new Map([[0, { seq: s.tick + 1, mx: 0, my: 0, buttons: 0 }]]))
    expect(bot.held).toBe('frigideira')
    // alvo com muito dano: o golpe forte aparece
    stand(bot, 200, 188)
    stand(hum, 300, 188)
    const moves = new Set<string>()
    for (let i = 0; i < 1800; i++) {
      hum.damage = Math.max(hum.damage, 80)
      hum.stocks = 3
      // o alvo é um boneco de treino: sempre de volta ao chão, de pé
      if (hum.action !== 'atordoado') stand(hum, 300, 188)
      brawlSim.step(s, new Map([[0, { seq: s.tick + 1, mx: 0, my: 0, buttons: 0 }]]))
      if (bot.move) moves.add(bot.move)
    }
    expect([...moves].some((m) => m.startsWith('teve:'))).toBe(true)
  })

  it('botInput é determinístico, seq cresce e botões válidos', () => {
    const a = make(bots(2), { botLevel: 'medio' }, 3)
    const b = make(bots(2), { botLevel: 'medio' }, 3)
    skipCountdown(a)
    skipCountdown(b)
    for (let i = 0; i < 300; i++) {
      const ia = brawlSim.botInput(a, 8)
      const ib = brawlSim.botInput(b, 8)
      expect(ia).toEqual(ib)
      expect(ia.seq).toBe(fighter(a, 8).lastSeq + 1)
      expect(ia.buttons & ~BTN_MASK).toBe(0)
      expect(Math.abs(ia.mx)).toBeLessThanOrEqual(1)
      brawlSim.step(a, new Map())
      brawlSim.step(b, new Map())
    }
    // robô eliminado não faz nada
    fighter(a, 8).action = 'eliminado'
    expect(brawlSim.botInput(a, 8)).toMatchObject({ ...EMPTY_BRAWL_INPUT, seq: fighter(a, 8).lastSeq + 1 })
  })

  it('a memória do robô é serializável e o clone joga igual', () => {
    const s = make(bots(3), { botLevel: 'dificil' }, 8)
    stepN(s, 1200)
    const copy = JSON.parse(JSON.stringify(s))
    const c = brawlSim.cloneState(copy)
    stepN(s, 600)
    stepN(c, 600)
    expect(JSON.stringify(c)).toBe(JSON.stringify(s))
  })

  it('times: robôs do mesmo time não se atacam', () => {
    const refs = bots(4).map((b, i) => ({ ...b, team: i % 2 }))
    const s = make(refs, { teamSize: 2, botLevel: 'dificil' }, 6)
    for (let i = 0; i < 4000 && s.phase !== 'fim'; i++) {
      for (const e of brawlSim.step(s, new Map())) {
        if (e.type === 'hit') {
          const a = fighter(s, e.attacker)
          const v = fighter(s, e.victim)
          expect(a.team).not.toBe(v.team)
        }
      }
    }
  })
})
