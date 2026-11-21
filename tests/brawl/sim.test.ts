import { beforeEach, describe, expect, it } from 'vitest'
import { ARENAS } from '../../src/shared/games/brawl/arenas'
import { CHARACTERS } from '../../src/shared/games/brawl/characters'
import { MOVES, moveFor } from '../../src/shared/games/brawl/moves'
import { brawlSim } from '../../src/shared/games/brawl/sim'
import {
  BTN_DODGE,
  BTN_HEAVY,
  BTN_JUMP,
  BTN_LIGHT,
  BTN_PICK,
  COUNTDOWN_TICKS,
  DODGE_COOLDOWN_TICKS,
  DODGE_TICKS,
  MAX_DAMAGE,
  MAX_JUMPS,
  RESPAWN_TICKS,
  type BrawlSimEvent
} from '../../src/shared/games/brawl/types'
import { bots, fighter, humans, input, make, resetSeq, skipCountdown, stand, stepN } from './helpers'

beforeEach(() => resetSeq())

const find = <T extends BrawlSimEvent['type']>(evs: BrawlSimEvent[], type: T) => evs.filter((e): e is Extract<BrawlSimEvent, { type: T }> => e.type === type)

describe('arenas e golpes (dados)', () => {
  it('geometria oficial', () => {
    const e = ARENAS.estante
    expect(e.platforms[0]).toMatchObject({ x: 96, y: 188, w: 288, h: 46, thin: false })
    expect(e.platforms.filter((p) => p.thin).map((p) => [p.x, p.y, p.w])).toEqual([
      [124, 140, 84],
      [272, 140, 84],
      [204, 96, 72]
    ])
    expect(e.respawn).toEqual({ x: 240, y: 40 })
    expect(e.blast).toEqual({ left: -70, right: 550, top: -90, bottom: 330 })
    const t = ARENAS.telhado
    expect(t.platforms[0]).toMatchObject({ x: 64, y: 196, w: 352, h: 50, thin: false })
    expect(t.platforms.find((p) => p.x === 352)).toMatchObject({ y: 168, w: 28, h: 28, thin: false })
    expect(t.blast).toEqual({ left: -80, right: 560, top: -90, bottom: 330 })
    for (const a of [e, t]) {
      expect(a.spawns.length).toBe(12)
      for (const sp of a.spawns) {
        // todo spawn está em cima de alguma plataforma
        expect(a.platforms.some((p) => sp.x > p.x && sp.x < p.x + p.w && sp.y === p.y)).toBe(true)
      }
    }
  })

  it('tabela de golpes completa e moveFor', () => {
    for (const held of ['mao', 'vassoura', 'frigideira', 'luvas'] as const) {
      for (const d of ['neutro', 'lado', 'baixo'] as const) expect(MOVES[`${held}:${d}`]).toBeDefined()
      for (const d of ['neutro', 'lado', 'baixo', 'cima'] as const) expect(MOVES[`${held}:ar-${d}`]).toBeDefined()
    }
    expect(MOVES['vassoura:ar-cima'].recovery_move).toBe(true)
    expect(MOVES['luvas:ar-baixo'].selfVy).toBeGreaterThan(0)
    // vassoura alcança mais que luvas; frigideira é a mais lenta
    const reach = (id: string) => MOVES[id].frames[0][0].x + MOVES[id].frames[0][0].w
    expect(reach('vassoura:lado')).toBeGreaterThan(reach('mao:lado'))
    expect(reach('luvas:lado')).toBeLessThan(reach('mao:lado'))
    expect(MOVES['frigideira:lado'].startup).toBeGreaterThan(MOVES['vassoura:lado'].startup)
    expect(MOVES['luvas:lado'].startup).toBeLessThan(MOVES['mao:lado'].startup + 1)
    expect(moveFor('jan', 'mao', 'forte', 'lado').id).toBe('mao:forte-lado')
    expect(moveFor('jan', 'vassoura', 'forte', 'neutro').id).toBe('jan:vassoura:neutro')
    expect(moveFor('xicara', 'luvas', 'leve', 'baixo').id).toBe('luvas:baixo')
    expect(moveFor('teve', 'frigideira', 'ar', 'cima').id).toBe('frigideira:ar-cima')
    // assinaturas: Wi-Fi tem 3 arcos que atravessam, vapor atravessa, café deixa poça
    const wifi = MOVES['janja:vassoura:lado']
    expect(wifi.projectile).toMatchObject({ kind: 'wifi', count: 3, pierce: true })
    expect(wifi.projectile!.lastHit!.kbGrowth).toBeGreaterThan(wifi.projectile!.hit.kbGrowth)
    expect(MOVES['xicara:vassoura:lado'].puddle).toBeTruthy()
    // todo golpe tem direção unitária
    for (const m of Object.values(MOVES)) for (const f of m.frames) for (const b of f) expect(Math.abs(Math.sqrt(b.dx * b.dx + b.dy * b.dy) - 1)).toBeLessThan(1e-9)
  })

  it('personagens: peso e agilidade', () => {
    expect(CHARACTERS.teve.kbMul).toBeCloseTo(0.85)
    expect(CHARACTERS.xicara.kbMul).toBeCloseTo(1.15)
    expect(CHARACTERS.xicara.runSpeed).toBeGreaterThan(CHARACTERS.jan.runSpeed)
    expect(CHARACTERS.teve.runSpeed).toBeLessThan(CHARACTERS.jan.runSpeed)
    expect(CHARACTERS.janja.kbMul).toBeGreaterThanOrEqual(1)
    expect(CHARACTERS.janja.kbMul).toBeLessThan(CHARACTERS.xicara.kbMul)
  })
})

describe('contagem e movimento', () => {
  it('contagem 3, 2, 1: sem controle até o go', () => {
    const s = make(humans(2))
    expect(s.phase).toBe('contagem')
    const evs: BrawlSimEvent[] = []
    for (let i = 0; i < COUNTDOWN_TICKS + 2; i++) {
      const before = s.tick
      evs.push(...brawlSim.step(s, input(0, { mx: 1, buttons: BTN_JUMP })))
      if (before < COUNTDOWN_TICKS) expect(fighter(s, 0).x).toBe(ARENAS.estante.spawns[0].x)
    }
    expect(find(evs, 'go')).toHaveLength(1)
    expect(s.phase).toBe('jogando')
    expect(fighter(s, 0).x).toBeGreaterThan(ARENAS.estante.spawns[0].x)
  })

  it('corre, para e vira', () => {
    const s = make(humans(1))
    skipCountdown(s)
    const f = fighter(s, 0)
    stand(f, 240, 188)
    stepN(s, 30, () => input(0, { mx: 1 }))
    expect(f.facing).toBe(1)
    expect(f.vx).toBeCloseTo(CHARACTERS[f.char].runSpeed)
    expect(f.action).toBe('correndo')
    stepN(s, 30, () => input(0, { mx: -1 }))
    expect(f.facing).toBe(-1)
    expect(f.vx).toBeLessThan(0)
    stepN(s, 30, () => input(0))
    expect(f.vx).toBe(0)
    expect(f.action).toBe('parado')
  })

  it('pula 3 vezes (1 no chão + 2 no ar) e a 4ª não faz nada', () => {
    const s = make(humans(1, ['jan']))
    skipCountdown(s)
    const f = fighter(s, 0)
    stand(f, 240, 188)
    f.y = 100 // no ar: sobe e cai de novo depois
    f.y = 188
    const evs: BrawlSimEvent[] = []
    const ups: number[] = []
    const vyBefore: number[] = []
    for (let k = 0; k < 4; k++) {
      vyBefore.push(f.vy)
      evs.push(...stepN(s, 1, () => input(0, { buttons: BTN_JUMP })))
      ups.push(f.vy)
      evs.push(...stepN(s, 8, () => input(0)))
    }
    expect(ups[0]).toBeLessThan(-5)
    expect(ups[1]).toBeLessThan(-5)
    expect(ups[2]).toBeLessThan(-5)
    expect(ups[3]).toBeGreaterThan(vyBefore[3]) // a 4ª só cai: sem pulo sobrando
    expect(find(evs, 'jump').map((e) => e.air)).toEqual([false, true, true])
    expect(f.jumpsLeft).toBe(0)
    // ao pousar, tudo volta
    stepN(s, 200, () => input(0))
    expect(f.grounded).toBe(true)
    expect(f.jumpsLeft).toBe(MAX_JUMPS)
  })

  it('sair da borda andando gasta o pulo do chão', () => {
    const s = make(humans(1))
    skipCountdown(s)
    const f = fighter(s, 0)
    stand(f, 380, 188)
    stepN(s, 12, () => input(0, { mx: 1 }))
    expect(f.grounded).toBe(false)
    expect(f.jumpsLeft).toBe(MAX_JUMPS - 1)
  })

  it('queda rápida chega mais rápido', () => {
    const run = (down: boolean) => {
      const s = make(humans(1))
      skipCountdown(s)
      const f = fighter(s, 0)
      f.x = 20
      f.y = -50
      f.grounded = false
      stepN(s, 30, () => input(0, { my: down ? 1 : 0 }))
      return f.y
    }
    expect(run(true)).toBeGreaterThan(run(false) + 20)
  })

  it('colisão sólida: chão, lados e teto', () => {
    const s = make(humans(1, ['jan']))
    skipCountdown(s)
    const f = fighter(s, 0)
    const hw = CHARACTERS.jan.hurtW / 2
    // chão: cai de cima e pára no topo da base
    f.x = 110
    f.y = 100
    f.grounded = false
    stepN(s, 60)
    expect(f.y).toBe(188)
    expect(f.grounded).toBe(true)
    // lado: vindo da esquerda, pelo lado da base (abaixo do topo)
    f.x = 80
    f.y = 205
    f.vx = 0
    f.vy = 0
    f.grounded = false
    stepN(s, 10, () => input(0, { mx: 1 }))
    expect(f.x).toBeLessThanOrEqual(96 - hw + 1e-9)
    // teto: por baixo da base, o pulo bate e volta
    f.x = 240
    f.y = 300
    f.vy = -9
    f.grounded = false
    stepN(s, 12)
    expect(f.y).toBeGreaterThan(234 + CHARACTERS.jan.hurtH - 1)
  })
})

describe('parede', () => {
  it('agarrar a parede devolve um pulo e o pulo da parede empurra para longe', () => {
    const s = make(humans(1, ['jan']))
    skipCountdown(s)
    const f = fighter(s, 0)
    f.x = 86
    f.y = 215
    f.vx = 0
    f.vy = 0
    f.grounded = false
    f.jumpsLeft = 0
    const evs = stepN(s, 6, () => input(0, { mx: 1 }))
    expect(f.action).toBe('parede')
    expect(f.wallSide).toBe(1)
    expect(f.jumpsLeft).toBe(1)
    expect(find(evs, 'wall')).toHaveLength(1)
    expect(f.vy).toBeLessThanOrEqual(0.8 + 1e-9) // desliza devagar
    stepN(s, 1, () => input(0, { mx: 1, buttons: BTN_JUMP }))
    expect(f.vy).toBeLessThan(-4)
    expect(f.vx).toBeLessThan(0)
    expect(f.jumpsLeft).toBe(0)
  })

  it('só agarra enquanto aperta para a parede e por tempo limitado', () => {
    const s = make(humans(1, ['jan']))
    skipCountdown(s)
    const f = fighter(s, 0)
    f.x = 86
    f.y = 215
    f.vy = 0
    f.grounded = false
    stepN(s, 3, () => input(0, { mx: 1 }))
    expect(f.action).toBe('parede')
    stepN(s, 3, () => input(0))
    expect(f.wallSide).toBe(0)
    expect(f.action).not.toBe('parede')
  })
})

describe('plataforma fina', () => {
  it('pisa em cima, atravessa por baixo e desce com "para baixo"', () => {
    const s = make(humans(1, ['jan']))
    skipCountdown(s)
    const f = fighter(s, 0)
    // por baixo: o pulo passa e ela pousa em cima
    f.x = 166
    f.y = 188
    f.vy = -9
    f.grounded = false
    stepN(s, 60)
    expect(f.y).toBe(140)
    expect(f.grounded).toBe(true)
    // fica parado em cima
    stepN(s, 30)
    expect(f.y).toBe(140)
    // para baixo: atravessa e para na base
    stepN(s, 40, () => input(0, { my: 1 }))
    expect(f.y).toBe(188)
    expect(f.grounded).toBe(true)
  })
})

describe('esquiva', () => {
  it('invulnerável durante a esquiva, com recarga', () => {
    const s = make(humans(2, ['jan', 'jan']))
    skipCountdown(s)
    const a = fighter(s, 0)
    const b = fighter(s, 1)
    stand(a, 200, 188)
    stand(b, 215, 188)
    a.facing = 1
    b.facing = -1
    const evs = stepN(s, 1, () => input(1, { buttons: BTN_DODGE }))
    expect(find(evs, 'dodge')).toHaveLength(1)
    expect(b.action).toBe('esquiva')
    expect(b.invulnUntil).toBeGreaterThanOrEqual(s.tick + DODGE_TICKS - 1)
    // jan bate com tudo em cima dele durante a esquiva: nada acontece
    const hits: BrawlSimEvent[] = []
    hits.push(...stepN(s, 1, () => input(0, { buttons: BTN_LIGHT })))
    for (let i = 0; i < DODGE_TICKS - 3; i++) hits.push(...stepN(s, 1, () => input(0)))
    expect(find(hits, 'hit')).toHaveLength(0)
    expect(b.damage).toBe(0)
    // recarga: nova esquiva logo depois não vale
    stepN(s, 8)
    const early = stepN(s, 1, () => input(1, { buttons: BTN_DODGE }))
    expect(find(early, 'dodge')).toHaveLength(0)
    stepN(s, 1, () => input(1))
    stepN(s, DODGE_COOLDOWN_TICKS)
    const later = stepN(s, 1, () => input(1, { buttons: BTN_DODGE }))
    expect(find(later, 'dodge')).toHaveLength(1)
  })

  it('esquiva direcional anda, no ar só uma vez por pulo', () => {
    const s = make(humans(1))
    skipCountdown(s)
    const f = fighter(s, 0)
    stand(f, 240, 188)
    stepN(s, 1, () => input(0, { mx: 1, buttons: BTN_DODGE }))
    expect(f.vx).toBeCloseTo(4.2)
    stepN(s, 1, () => input(0))
    // no ar
    f.x = 240
    f.y = 60
    f.grounded = false
    f.vx = 0
    f.vy = 0
    f.dodgeReadyTick = 0
    f.action = 'no-ar'
    const e1 = stepN(s, 1, () => input(0, { mx: -1, buttons: BTN_DODGE }))
    expect(find(e1, 'dodge')).toHaveLength(1)
    stepN(s, DODGE_TICKS + 1, () => input(0))
    f.dodgeReadyTick = 0
    f.y = 60
    f.vy = 0
    const e2 = stepN(s, 1, () => input(0, { buttons: BTN_DODGE }))
    expect(find(e2, 'dodge')).toHaveLength(0)
  })
})

describe('golpes, dano e empurrão', () => {
  function duel(victimDamage = 0, victimChar: 'jan' | 'xicara' | 'teve' | 'janja' = 'jan') {
    const s = make([...humans(1, ['jan']), { slot: 1, id: 'v', bot: false, char: victimChar, team: 1 }])
    skipCountdown(s)
    const a = fighter(s, 0)
    const v = fighter(s, 1)
    stand(a, 200, 188)
    stand(v, 218, 188)
    a.facing = 1
    v.damage = victimDamage
    return { s, a, v }
  }

  it('golpe com startup, ativo e recuperação; acerta e dá dano', () => {
    const { s, a, v } = duel()
    const m = MOVES['mao:neutro']
    const hits: BrawlSimEvent[] = []
    hits.push(...stepN(s, 1, () => input(0, { buttons: BTN_LIGHT })))
    expect(a.action).toBe('golpe')
    expect(a.move).toBe('mao:neutro')
    // nada acerta no startup
    for (let i = 0; i < m.startup - 1; i++) hits.push(...stepN(s, 1, () => input(0)))
    expect(find(hits, 'hit')).toHaveLength(0)
    expect(v.damage).toBe(0)
    hits.push(...stepN(s, 3, () => input(0)))
    const h = find(hits, 'hit')
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ attacker: 0, victim: 1, move: 'mao:neutro' })
    expect(v.damage).toBe(m.frames[0][0].damage)
    expect(a.dealt).toBe(m.frames[0][0].damage)
    expect(v.action).toBe('atordoado')
    expect(v.vx).toBeGreaterThan(0)
    // termina e volta ao normal
    stepN(s, 60)
    expect(a.move).toBeNull()
    expect(a.action).not.toBe('golpe')
    expect(v.action).not.toBe('atordoado')
  })

  it('hitbox espelha pelo facing: bate para a esquerda e não acerta quem está atrás', () => {
    const { s, a, v } = duel()
    stand(a, 218, 188)
    stand(v, 200, 188) // vítima à esquerda
    a.facing = 1 // olhando para o outro lado: erra
    const miss = stepN(s, 20, () => input(0, { buttons: BTN_LIGHT }))
    expect(find(miss, 'hit')).toHaveLength(0)
    stepN(s, 60, () => input(0))
    // agora vira para a esquerda (mx -1 com golpe lateral olha para lá) e acerta
    const hit = stepN(s, 20, () => input(0, { mx: -1, buttons: BTN_LIGHT }))
    expect(find(hit, 'hit').length).toBeGreaterThanOrEqual(1)
    expect(v.vx).toBeLessThan(0)
  })

  it('hit-stop congela atacante e vítima; força vai de 0 a 3', () => {
    const { s, a, v } = duel()
    stepN(s, 1, () => input(0, { buttons: BTN_LIGHT }))
    const evs: BrawlSimEvent[] = []
    for (let i = 0; i < 12 && find(evs, 'hit').length === 0; i++) evs.push(...stepN(s, 1, () => input(0)))
    const h = find(evs, 'hit')[0]
    expect(h).toBeTruthy()
    expect([0, 1, 2, 3]).toContain(h.strength)
    expect(a.freezeUntil).toBeGreaterThan(s.tick)
    expect(v.freezeUntil).toBeGreaterThan(s.tick)
    const px = v.x
    const mt = a.moveTick
    stepN(s, 1, () => input(0))
    expect(v.x).toBe(px)
    expect(a.moveTick).toBe(mt)
    stepN(s, 12, () => input(0))
    expect(v.x).toBeGreaterThan(px)
  })

  it('empurrão cresce com o dano do alvo', () => {
    const speed = (dmg: number) => {
      const { s, a, v } = duel(dmg)
      stepN(s, 1, () => input(0, { buttons: BTN_LIGHT }))
      const evs: BrawlSimEvent[] = []
      for (let i = 0; i < 12 && find(evs, 'hit').length === 0; i++) evs.push(...stepN(s, 1, () => input(0)))
      void a
      return Math.sqrt(v.vx * v.vx + v.vy * v.vy)
    }
    const k0 = speed(0)
    const k100 = speed(100)
    const k250 = speed(250)
    expect(k100).toBeGreaterThan(k0 * 1.3)
    expect(k250).toBeGreaterThan(k100)
    // fórmula: (base + dano * growth / 100) * peso
    const b = MOVES['mao:neutro'].frames[0][0]
    expect(k0).toBeCloseTo((b.baseKb + (b.damage * b.kbGrowth) / 100) * 1, 5)
  })

  it('o peso muda o voo: Xícara voa mais que Tevê', () => {
    const speed = (c: 'xicara' | 'teve' | 'jan') => {
      const { s, v } = duel(60, c)
      stepN(s, 1, () => input(0, { buttons: BTN_LIGHT }))
      const evs: BrawlSimEvent[] = []
      for (let i = 0; i < 12 && find(evs, 'hit').length === 0; i++) evs.push(...stepN(s, 1, () => input(0)))
      return Math.sqrt(v.vx * v.vx + v.vy * v.vy)
    }
    const x = speed('xicara')
    const j = speed('jan')
    const t = speed('teve')
    expect(x).toBeGreaterThan(j)
    expect(j).toBeGreaterThan(t)
    expect(x / t).toBeCloseTo(1.15 / 0.85, 5)
  })

  it('dano só sobe (até MAX_DAMAGE)', () => {
    const { s, v } = duel(MAX_DAMAGE - 2)
    const seen: number[] = []
    for (let i = 0; i < 200; i++) {
      stepN(s, 1, () => input(0, { buttons: i % 20 === 0 ? BTN_LIGHT : 0 }))
      if (v.action === 'fora') break
      seen.push(v.damage)
    }
    expect(seen.every((d, i) => i === 0 || d >= seen[i - 1])).toBe(true)
    expect(Math.max(...seen)).toBeLessThanOrEqual(MAX_DAMAGE)
    expect(Math.max(...seen)).toBe(MAX_DAMAGE)
  })

  it('golpe forte carrega: mais dano e empurrão', () => {
    const run = (hold: number) => {
      const { s, v } = duel()
      const evs: BrawlSimEvent[] = []
      for (let i = 0; i < hold; i++) evs.push(...stepN(s, 1, () => input(0, { buttons: BTN_HEAVY })))
      for (let i = 0; i < 40 && find(evs, 'hit').length === 0; i++) evs.push(...stepN(s, 1, () => input(0)))
      const atk = find(evs, 'attack')[0]
      const h = find(evs, 'hit')[0]
      return { dmg: v.damage, kb: h.kb, charge: atk?.charge ?? 0 }
    }
    const quick = run(1)
    const full = run(80)
    expect(full.charge).toBe(60)
    expect(quick.charge).toBeLessThan(5)
    expect(full.dmg).toBeGreaterThan(quick.dmg)
    expect(full.kb).toBeGreaterThan(quick.kb * 1.25)
  })

  it('fogo amigo: desligado, o time não se machuca; ligado, machuca', () => {
    for (const ff of [false, true]) {
      const s = make([{ slot: 0, id: 'a', bot: false, char: 'jan', team: 0 }, { slot: 1, id: 'b', bot: false, char: 'jan', team: 0 }, { slot: 2, id: 'c', bot: false, char: 'jan', team: 1 }], { teamSize: 2, friendlyFire: ff })
      skipCountdown(s)
      stand(fighter(s, 0), 200, 188)
      stand(fighter(s, 1), 218, 188)
      stand(fighter(s, 2), 300, 188)
      stepN(s, 25, () => input(0, { buttons: BTN_LIGHT }))
      expect(fighter(s, 1).damage > 0).toBe(ff)
    }
  })

  it('compensação de atraso: confere o acerto contra a posição do alvo no passado', () => {
    const run = (lag: number) => {
      const { s, a, v } = duel()
      const m = MOVES['mao:neutro']
      stepN(s, 1, () => input(0, { buttons: BTN_LIGHT, ...({ lagTicks: lag } as object) }))
      // na hora do golpe ativo, a vítima (na tela do atacante ainda perto) já se afastou no host
      while (a.moveTick < m.startup) stepN(s, 1, () => new Map([[0, { seq: 100 + s.tick, mx: 0, my: 0, buttons: 0, lagTicks: lag }]]))
      v.x += 120
      const evs = stepN(s, 1, () => new Map([[0, { seq: 100 + s.tick, mx: 0, my: 0, buttons: 0, lagTicks: lag }]]))
      return find(evs, 'hit').length
    }
    expect(run(0)).toBe(0)
    expect(run(2)).toBe(1)
  })
})

describe('golpes especiais', () => {
  it('Wi-Fi da JanJa: 3 arcos que atravessam, o último empurra mais', () => {
    const s = make([...humans(1, ['janja']), { slot: 1, id: 'v', bot: false, char: 'jan', team: 1 }])
    skipCountdown(s)
    const a = fighter(s, 0)
    const v = fighter(s, 1)
    stand(a, 150, 188)
    stand(v, 250, 188)
    a.facing = 1
    a.held = 'vassoura'
    const evs: BrawlSimEvent[] = []
    evs.push(...stepN(s, 1, () => input(0, { mx: 1, buttons: BTN_HEAVY })))
    let maxProj = 0
    for (let i = 0; i < 90; i++) {
      evs.push(...stepN(s, 1, () => input(0)))
      maxProj = Math.max(maxProj, s.projectiles.length)
    }
    expect(maxProj).toBeGreaterThanOrEqual(2)
    const hits = find(evs, 'hit').filter((e) => e.move === 'proj:wifi')
    expect(hits.length).toBe(3) // cada arco acerta uma vez
    expect(hits[2].damage).toBeGreaterThan(hits[0].damage)
  })

  it('Derramou da Xícara deixa café no chão que faz deslizar', () => {
    const s = make(humans(1, ['xicara']))
    skipCountdown(s)
    const f = fighter(s, 0)
    stand(f, 200, 188)
    f.facing = 1
    f.held = 'luvas'
    stepN(s, 1, () => input(0, { mx: 1, buttons: BTN_HEAVY }))
    stepN(s, 40, () => input(0))
    expect(s.puddles.length).toBeGreaterThan(0)
    expect(s.puddles.every((p) => p.y === 188)).toBe(true)
    // sobre a poça, soltar o botão não pára de uma vez
    const p = s.puddles[0]
    stand(f, p.x, 188)
    f.vx = 3
    stepN(s, 10)
    const slide = f.x - p.x
    stand(f, 300, 188) // sem poça
    f.vx = 3
    const x0 = f.x
    stepN(s, 10)
    expect(slide).toBeGreaterThan(f.x - x0 + 5)
  })

  it('recuperação (ar-cima) só 1 vez por pulo', () => {
    const s = make(humans(1, ['jan']))
    skipCountdown(s)
    const f = fighter(s, 0)
    f.x = 40
    f.y = 120
    f.vy = 0
    f.grounded = false
    stepN(s, 1, () => input(0, { my: -1, buttons: BTN_LIGHT }))
    expect(f.move).toBe('mao:ar-cima')
    expect(f.recoveryUsed).toBe(true)
    expect(f.vy).toBeLessThan(-6)
    stepN(s, 60, () => input(0))
    f.vy = 0
    stepN(s, 1, () => input(0, { my: -1, buttons: BTN_LIGHT }))
    expect(f.move).toBe('mao:ar-neutro') // sem a recuperação de novo
  })
})

describe('nocaute, vidas e renascer', () => {
  const sides = [
    ['esquerda', -80, 100],
    ['direita', 560, 100],
    ['baixo', 240, 340],
    ['cima', 240, -100]
  ] as const
  for (const [side, x, y] of sides) {
    it(`nocaute pela borda ${side}`, () => {
      const s = make(humans(2))
      skipCountdown(s)
      const f = fighter(s, 0)
      f.x = x
      f.y = y
      f.vx = 0
      f.vy = 0
      f.grounded = false
      f.damage = 120
      if (side === 'cima') f.hitstunUntil = s.tick + 50
      f.lastHitBy = 1
      f.lastHitTick = s.tick
      const evs = stepN(s, 1)
      const ko = find(evs, 'ko')
      expect(ko).toHaveLength(1)
      expect(ko[0]).toMatchObject({ victim: 0, killer: 1, side })
      expect(f.stocks).toBe(2)
      expect(f.damage).toBe(0)
      expect(f.action).toBe('fora')
      expect(fighter(s, 1).kos).toBe(1)
      expect(f.falls).toBe(1)
    })
  }

  it('o topo só vale em hitstun', () => {
    const s = make(humans(2))
    skipCountdown(s)
    const f = fighter(s, 0)
    f.x = 240
    f.y = -100
    f.vy = 0
    f.grounded = false
    expect(find(stepN(s, 1), 'ko')).toHaveLength(0)
  })

  it('renasce em RESPAWN_TICKS com invulnerabilidade; perde a arma; vidas só descem; eliminado', () => {
    const s = make(humans(2), { stocks: 2 })
    skipCountdown(s)
    const f = fighter(s, 0)
    f.held = 'vassoura'
    f.x = -200
    const evs = stepN(s, 1)
    expect(find(evs, 'ko')).toHaveLength(1)
    expect(find(evs, 'last-stock')).toHaveLength(1)
    expect(f.held).toBe('mao')
    const t0 = s.tick
    const stocks: number[] = []
    let respawned = false
    for (let i = 0; i < RESPAWN_TICKS + 5; i++) {
      const e = stepN(s, 1)
      stocks.push(f.stocks)
      if (find(e, 'respawn').length) {
        respawned = true
        expect(s.tick - t0).toBeGreaterThanOrEqual(RESPAWN_TICKS - 1)
        expect(f.invulnUntil).toBeGreaterThan(s.tick)
      }
    }
    expect(respawned).toBe(true)
    expect(stocks.every((x, i) => i === 0 || x <= stocks[i - 1])).toBe(true)
    // segunda queda: sem vidas, eliminado e a luta acaba
    f.x = -200
    const last = stepN(s, 1)
    expect(find(last, 'eliminated')).toHaveLength(1)
    expect(f.action).toBe('eliminado')
    expect(f.outTick).toBeGreaterThan(0)
    expect(s.phase).toBe('fim')
    const r = brawlSim.ranking(s)
    expect(r[0].id).toBe('player-1')
    expect(r[1].id).toBe('player-0')
  })

  it('modo tempo: não perde vidas, ranking por abates - quedas', () => {
    const s = make(humans(3), { mode: 'tempo', minutes: 2 })
    skipCountdown(s)
    expect(s.endTick).toBe(COUNTDOWN_TICKS + 2 * 60 * 60)
    const f = fighter(s, 2)
    f.x = -200
    f.lastHitBy = 0
    f.lastHitTick = s.tick
    stepN(s, 1)
    expect(f.action).toBe('fora')
    expect(f.falls).toBe(1)
    expect(s.phase).toBe('jogando')
    const r = brawlSim.ranking(s)
    expect(r[0].id).toBe('player-0')
    expect(r[r.length - 1].id).toBe('player-2')
  })

  it('morte súbita: empate no fim do tempo, uma vida, acaba no próximo nocaute', () => {
    const s = make(humans(3), { mode: 'tempo', minutes: 2 })
    skipCountdown(s)
    s.tick = s.endTick - 1
    const evs = stepN(s, 2)
    expect(find(evs, 'phase').map((e) => e.phase)).toContain('morte-subita')
    expect(s.phase).toBe('morte-subita')
    expect(fighter(s, 0).stocks).toBe(1)
    stepN(s, 5)
    expect(s.phase).toBe('morte-subita')
    fighter(s, 1).x = -300
    fighter(s, 0).lastHitBy = -1
    stepN(s, 1)
    expect(s.phase).toBe('morte-subita') // sobraram 2
    fighter(s, 2).x = 900
    const end = stepN(s, 1)
    expect(s.phase).toBe('fim')
    expect(find(end, 'phase').map((e) => e.phase)).toContain('fim')
    expect(brawlSim.ranking(s)[0].id).toBe('player-0')
  })

  it('tempo sem empate acaba direto', () => {
    const s = make(humans(2), { mode: 'tempo', minutes: 2 })
    skipCountdown(s)
    fighter(s, 0).kos = 2
    s.tick = s.endTick
    stepN(s, 1)
    expect(s.phase).toBe('fim')
    expect(brawlSim.ranking(s)[0].id).toBe('player-0')
  })
})

describe('armas', () => {
  it('caem a cada 8 a 12 s, no rng, em dropX; pegar e arremessar', () => {
    const s = make(humans(2))
    skipCountdown(s)
    const evs: BrawlSimEvent[] = []
    // ninguém se mexe; 3 min de espera
    const dropTicks: number[] = []
    for (let i = 0; i < 60 * 60 && dropTicks.length < 3; i++) {
      const e = brawlSim.step(s, new Map())
      if (find(e, 'drop').length) dropTicks.push(s.tick)
      evs.push(...e)
    }
    expect(dropTicks.length).toBe(3)
    const gaps = [dropTicks[0] - COUNTDOWN_TICKS, dropTicks[1] - dropTicks[0], dropTicks[2] - dropTicks[1]]
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(480)
      expect(g).toBeLessThanOrEqual(720)
    }
    for (const d of find(evs, 'drop')) {
      expect(d.x).toBeGreaterThanOrEqual(ARENAS.estante.dropX[0])
      expect(d.x).toBeLessThanOrEqual(ARENAS.estante.dropX[1])
    }
  })

  it('pega no chão e arremessa como projétil que machuca', () => {
    const s = make(humans(2, ['jan', 'jan']))
    skipCountdown(s)
    const a = fighter(s, 0)
    const v = fighter(s, 1)
    stand(a, 200, 188)
    stand(v, 330, 188)
    a.facing = 1
    s.items.push({ id: 99, weapon: 'frigideira', x: 205, y: 188, vx: 0, vy: 0, state: 'chao', owner: -1, dieTick: s.tick + 1000 })
    const e1 = stepN(s, 1, () => input(0, { buttons: BTN_PICK }))
    expect(find(e1, 'pickup')).toEqual([{ type: 'pickup', slot: 0, weapon: 'frigideira' }])
    expect(a.held).toBe('frigideira')
    expect(s.items.find((i) => i.id === 99)).toBeUndefined()
    stepN(s, 2, () => input(0))
    const e2 = stepN(s, 1, () => input(0, { buttons: BTN_PICK }))
    expect(find(e2, 'throw')).toHaveLength(1)
    expect(a.held).toBe('mao')
    expect(s.projectiles.some((p) => p.kind === 'arma' && p.weapon === 'frigideira')).toBe(true)
    const evs = stepN(s, 60)
    const hit = find(evs, 'hit').filter((h) => h.move === 'proj:arma')
    expect(hit).toHaveLength(1)
    expect(v.damage).toBeGreaterThan(0)
    // a arma cai e dá para pegar de novo
    expect(s.items.some((i) => i.weapon === 'frigideira')).toBe(true)
  })

  it('o golpe muda com a arma da mão', () => {
    const s = make(humans(1, ['jan']))
    skipCountdown(s)
    const f = fighter(s, 0)
    stand(f, 240, 188)
    f.held = 'vassoura'
    stepN(s, 1, () => input(0, { buttons: BTN_LIGHT }))
    expect(f.move).toBe('vassoura:neutro')
  })
})

describe('entrar no meio', () => {
  it('modo tempo: quem chega luta; modo vidas: assiste', () => {
    for (const mode of ['tempo', 'vidas'] as const) {
      const s = make(humans(2), { mode })
      skipCountdown(s)
      stepN(s, 10)
      brawlSim.addPlayer(s, { slot: 2, id: 'novo', bot: false, char: 'teve', team: 2 })
      const f = fighter(s, 2)
      if (mode === 'tempo') {
        expect(f.action).toBe('fora')
        stepN(s, 40)
        expect(f.action).not.toBe('eliminado')
        expect(f.action).not.toBe('fora')
      } else {
        expect(f.action).toBe('eliminado')
        stepN(s, 100)
        expect(f.action).toBe('eliminado')
        expect(s.phase).toBe('jogando') // quem assiste não conta para acabar
      }
    }
  })

  it('setAway tira o lutador de cena e ele volta renascendo', () => {
    const s = make(humans(3))
    skipCountdown(s)
    brawlSim.setAway(s, 2, true)
    expect(fighter(s, 2).away).toBe(true)
    stepN(s, 5)
    brawlSim.setAway(s, 2, false)
    expect(fighter(s, 2).away).toBe(false)
    expect(fighter(s, 2).action).toBe('fora')
    stepN(s, 40)
    expect(fighter(s, 2).action).not.toBe('fora')
  })

  it('robôs entram pelo slot 8', () => {
    const s = make([...humans(1), ...bots(2)])
    expect(s.fighters.map((f) => f.slot)).toEqual([0, 8, 9])
    expect(s.fighters.map((f) => f.x)).toEqual([ARENAS.estante.spawns[0].x, ARENAS.estante.spawns[8].x, ARENAS.estante.spawns[9].x])
  })
})
