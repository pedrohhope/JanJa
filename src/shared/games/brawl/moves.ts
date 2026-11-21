/**
 * Tabela de golpes (dados de quadro). TUDO que mexe no equilíbrio dos golpes está neste arquivo.
 * Hitbox: relativa aos pés, x para a FRENTE (o sim espelha pelo facing), y negativo = para cima.
 *
 * Ids (veja types.ts): leve `${Held}:${dir}`, aéreo `${Held}:ar-${dir}`, forte `${char}:${arma}:${dir}`
 * e `mao:forte-${dir}` (desarmado, genérico). As assinaturas das 3 armas são a mesma do personagem,
 * com pequenos ajustes de alcance, dano e velocidade (HELD_TUNE).
 */
import {
  CHARACTER_IDS,
  WEAPON_IDS,
  type AirDir,
  type AttackDir,
  type CharacterId,
  type Held,
  type Hitbox,
  type MoveData,
  type MoveId,
  type ProjectileSpec,
  type WeaponId
} from './types'

type Dir = readonly [number, number]
type HitStats = Omit<Hitbox, 'x' | 'y' | 'w' | 'h'>

const unit = (dx: number, dy: number): { dx: number; dy: number } => {
  const l = Math.sqrt(dx * dx + dy * dy)
  return { dx: dx / l, dy: dy / l }
}

function box(x: number, y: number, w: number, h: number, damage: number, baseKb: number, kbGrowth: number, dir: Dir): Hitbox {
  const u = unit(dir[0], dir[1])
  return { x, y, w, h, damage, baseKb, kbGrowth, dx: u.dx, dy: u.dy }
}

function stats(damage: number, baseKb: number, kbGrowth: number, dir: Dir): HitStats {
  const u = unit(dir[0], dir[1])
  return { damage, baseKb, kbGrowth, dx: u.dx, dy: u.dy }
}

// =====================================================================================
// Direções de empurrão usadas pela tabela
// =====================================================================================
const D_UP_FWD: Dir = [0.8, -0.6]
const D_FWD: Dir = [0.95, -0.3]
const D_LOW: Dir = [0.5, -0.87]
const D_UP: Dir = [0.2, -0.98]
const D_SPIKE: Dir = [0.3, 0.95]

// =====================================================================================
// Leves e aéreos por arma. Linha: [startup, ativo, recuperação, x, y, w, h, dano, baseKb, kbGrowth, dir, nome, selfVy?]
// =====================================================================================
type Row = [number, number, number, number, number, number, number, number, number, number, Dir, string, number?]

const LIGHT: Record<Held, Record<AttackDir, Row>> = {
  mao: {
    neutro: [4, 3, 9, 6, -26, 16, 12, 5, 2.2, 3.5, D_UP_FWD, 'Soco'],
    lado: [5, 3, 11, 6, -24, 20, 12, 7, 2.8, 4.5, D_FWD, 'Cruzado'],
    baixo: [5, 4, 11, 4, -14, 22, 12, 6, 2.4, 4, D_LOW, 'Rasteira']
  },
  vassoura: {
    neutro: [6, 4, 13, 8, -30, 34, 12, 8, 2.8, 5, D_UP_FWD, 'Vassourada'],
    lado: [8, 4, 16, 8, -24, 44, 12, 10, 3.4, 6.5, D_FWD, 'Varrida'],
    baixo: [7, 4, 15, 6, -14, 40, 12, 8, 2.8, 5.5, D_LOW, 'Varrida baixa']
  },
  frigideira: {
    neutro: [10, 4, 18, 6, -28, 28, 16, 12, 4.2, 8, D_UP_FWD, 'Panelada'],
    lado: [13, 5, 22, 6, -26, 34, 18, 16, 5, 10, D_FWD, 'Frigideirada'],
    baixo: [12, 4, 20, 4, -16, 32, 14, 12, 4.2, 8.5, [0.4, -0.92], 'Panela baixa']
  },
  luvas: {
    neutro: [2, 2, 6, 6, -26, 12, 12, 4, 1.8, 3, D_UP_FWD, 'Jab'],
    lado: [3, 2, 7, 6, -24, 14, 12, 5, 2, 3.5, D_FWD, 'Direto'],
    baixo: [3, 2, 7, 4, -14, 14, 12, 4, 1.8, 3, D_LOW, 'Gancho baixo']
  }
}

const AIR: Record<Held, Record<AirDir, Row>> = {
  mao: {
    neutro: [4, 4, 10, 4, -28, 24, 16, 6, 2.4, 4, D_UP_FWD, 'Golpe no ar'],
    lado: [5, 4, 12, 6, -26, 22, 14, 7, 2.8, 5, D_FWD, 'Cruzado no ar'],
    baixo: [6, 10, 14, -8, -6, 16, 12, 8, 3, 6, D_SPIKE, 'Pisão', 4.5],
    cima: [4, 5, 12, -8, -48, 16, 22, 6, 3, 5, D_UP, 'Impulso', -7.2]
  },
  vassoura: {
    neutro: [6, 5, 14, 6, -30, 36, 14, 8, 3, 5.5, D_UP_FWD, 'Vassourada no ar'],
    lado: [8, 5, 16, 8, -26, 44, 14, 10, 3.4, 6.5, D_FWD, 'Varrida no ar'],
    baixo: [7, 10, 16, -8, -6, 18, 16, 9, 3, 6.5, D_SPIKE, 'Pisão de vassoura', 4.8],
    cima: [6, 6, 14, -10, -58, 20, 28, 7, 3, 5.5, D_UP, 'Vassoura para cima', -7.6]
  },
  frigideira: {
    neutro: [9, 5, 18, 6, -28, 30, 18, 13, 4.2, 8, D_UP_FWD, 'Panelada no ar'],
    lado: [11, 5, 20, 6, -26, 34, 18, 16, 5, 10, D_FWD, 'Frigideirada no ar'],
    baixo: [10, 10, 20, -10, -8, 20, 16, 14, 4.5, 8.5, D_SPIKE, 'Pisão de panela', 5.2],
    cima: [9, 6, 18, -10, -54, 20, 24, 10, 3.6, 7, D_UP, 'Panela para cima', -7]
  },
  luvas: {
    neutro: [2, 3, 7, 4, -28, 18, 14, 5, 2, 3.5, D_UP_FWD, 'Jab no ar'],
    lado: [3, 3, 8, 6, -26, 16, 12, 6, 2.2, 4, D_FWD, 'Direto no ar'],
    baixo: [3, 8, 10, -6, -6, 12, 12, 6, 2.5, 4.5, D_SPIKE, 'Pisão de luva', 5],
    cima: [2, 4, 9, -6, -44, 12, 16, 5, 2.6, 4.5, D_UP, 'Soco para cima', -7.4]
  }
}

function fromRow(id: MoveId, r: Row, extra: Partial<MoveData> = {}): MoveData {
  const [startup, active, recovery, x, y, w, h, dmg, base, grow, dir, label, selfVy] = r
  const m: MoveData = { id, startup, active, recovery, frames: [[box(x, y, w, h, dmg, base, grow, dir)]], label, ...extra }
  if (selfVy !== undefined) m.selfVy = selfVy
  return m
}

// =====================================================================================
// Fortes genéricos (desarmado)
// =====================================================================================
const HAND_HEAVY: Record<AttackDir, Row> = {
  neutro: [9, 4, 18, 4, -30, 22, 20, 10, 4.2, 9, D_UP_FWD, 'Forte'],
  lado: [11, 5, 20, 4, -28, 28, 20, 13, 5, 10.5, D_FWD, 'Forte lateral'],
  baixo: [10, 5, 18, 4, -16, 30, 16, 11, 4.5, 9.5, [0.4, -0.92], 'Forte baixo']
}

// =====================================================================================
// Assinaturas por personagem (base; cada arma gera uma variante)
// =====================================================================================
const ring = (n: number, r0: number, step: number, y: number, h: number, w: number, hit: HitStats): Hitbox[][] => {
  // ondas que se afastam dos dois lados: `n` quadros
  const frames: Hitbox[][] = []
  for (let i = 0; i < n; i++) {
    const r = r0 + i * step
    frames.push([
      { x: r, y, w, h, ...hit },
      { x: -r - w, y, w, h, ...hit }
    ])
  }
  return frames
}

const SIGNATURES: Record<CharacterId, Record<AttackDir, MoveData>> = {
  jan: {
    // Leque de cartas: cartas giram em volta, acerta várias vezes
    neutro: {
      id: 'jan:neutro',
      label: 'Leque de cartas',
      startup: 7,
      active: 20,
      recovery: 16,
      multiHit: 10,
      frames: [[box(-26, -34, 52, 34, 4, 2.5, 5, [0.7, -0.7])]]
    },
    // Ombrada: investida
    lado: {
      id: 'jan:lado',
      label: 'Ombrada',
      startup: 6,
      active: 10,
      recovery: 20,
      selfVx: 5.2,
      frames: [[box(2, -28, 26, 26, 12, 4.5, 10, [0.93, -0.37])]]
    },
    // Embaralhar: cartas sobem do chão dos dois lados
    baixo: {
      id: 'jan:baixo',
      label: 'Embaralhar',
      startup: 9,
      active: 8,
      recovery: 20,
      frames: [[box(12, -24, 22, 24, 9, 4, 9, [0.15, -0.99]), box(-34, -24, 22, 24, 9, 4, 9, [0.15, -0.99])]]
    }
  },
  xicara: {
    // Vapor: jato para cima (projétil que atravessa)
    neutro: {
      id: 'xicara:neutro',
      label: 'Vapor',
      startup: 8,
      active: 1,
      recovery: 20,
      frames: [[]],
      projectile: {
        kind: 'vapor',
        count: 3,
        gapTicks: 5,
        x: 6,
        y: -26,
        vx: 0.5,
        vy: -2.8,
        w: 14,
        h: 20,
        lifeTicks: 28,
        pierce: true,
        hit: stats(3, 2.2, 3.5, D_UP)
      }
    },
    // Derramou: escorrega deixando café no chão
    lado: {
      id: 'xicara:lado',
      label: 'Derramou',
      startup: 5,
      active: 14,
      recovery: 18,
      selfVx: 4.8,
      puddle: { w: 36, ticks: 360 },
      frames: [[box(4, -18, 20, 18, 7, 3.5, 8, [0.9, -0.43])]]
    },
    // Pião: gira batendo em volta
    baixo: {
      id: 'xicara:baixo',
      label: 'Pião',
      startup: 8,
      active: 28,
      recovery: 20,
      multiHit: 9,
      frames: [[box(-22, -24, 44, 24, 3, 2.2, 4.5, [0.7, -0.7])]]
    }
  },
  teve: {
    // Estática: chiado em volta
    neutro: {
      id: 'teve:neutro',
      label: 'Estática',
      startup: 12,
      active: 26,
      recovery: 22,
      multiHit: 13,
      frames: [[box(-32, -40, 64, 42, 3, 2.5, 6, [0.5, -0.87])]]
    },
    // Raio catódico: a tela acende e empurra
    lado: {
      id: 'teve:lado',
      label: 'Raio catódico',
      startup: 14,
      active: 6,
      recovery: 28,
      frames: [[box(4, -34, 46, 30, 15, 5.5, 12, [0.97, -0.24])]]
    },
    // Desabou: cai de costas, onda de choque no chão
    baixo: {
      id: 'teve:baixo',
      label: 'Desabou',
      startup: 16,
      active: 6,
      recovery: 30,
      frames: [0, 1, 2, 3, 4, 5].map((i) => [
        box(4 + i * 6, -14, 28, 14, 13, 5, 10.5, [0.35, -0.94]),
        box(-32 - i * 6, -14, 28, 14, 13, 5, 10.5, [0.35, -0.94])
      ])
    }
  },
  janja: {
    // Tela compartilhada: a janela se abre em volta e empurra para fora
    neutro: {
      id: 'janja:neutro',
      label: 'Tela compartilhada',
      startup: 8,
      active: 8,
      recovery: 18,
      frames: [[box(-30, -46, 60, 48, 9, 4.2, 9.5, [0.8, -0.6])]]
    },
    // Sinal: 3 arcos de Wi-Fi que atravessam, o último empurra mais
    lado: {
      id: 'janja:lado',
      label: 'Sinal',
      startup: 10,
      active: 1,
      recovery: 22,
      frames: [[]],
      projectile: {
        kind: 'wifi',
        count: 3,
        gapTicks: 6,
        x: 10,
        y: -20,
        vx: 3.6,
        vy: 0,
        w: 16,
        h: 20,
        lifeTicks: 55,
        pierce: true,
        hit: stats(3, 2, 3, [0.9, -0.43]),
        lastHit: stats(6, 3.5, 8, [0.85, -0.5])
      }
    },
    // Mic aberto: grito em anel no chão, sobe quem está perto
    baixo: {
      id: 'janja:baixo',
      label: 'Mic aberto',
      startup: 10,
      active: 12,
      recovery: 22,
      frames: ring(12, 6, 3, -14, 14, 12, stats(7, 4, 8.5, [0.15, -0.99]))
    }
  }
}

// =====================================================================================
// Ajustes por arma nas assinaturas
// =====================================================================================
const HELD_TUNE: Record<WeaponId, { w: number; dmg: number; kb: number; startup: number; recovery: number }> = {
  vassoura: { w: 1.25, dmg: 1, kb: 1, startup: 0, recovery: 0 },
  frigideira: { w: 1, dmg: 1.2, kb: 1.1, startup: 3, recovery: 4 },
  luvas: { w: 0.85, dmg: 0.85, kb: 0.95, startup: -2, recovery: -4 }
}

function variant(base: MoveData, id: MoveId, held: WeaponId): MoveData {
  const t = HELD_TUNE[held]
  const m: MoveData = {
    ...base,
    id,
    startup: Math.max(2, base.startup + t.startup),
    recovery: Math.max(6, base.recovery + t.recovery),
    frames: base.frames.map((f) =>
      f.map((b) => ({ ...b, w: Math.max(6, Math.round(b.w * t.w)), damage: Math.max(1, Math.round(b.damage * t.dmg)), baseKb: b.baseKb * t.kb }))
    ),
    chargeable: true
  }
  return m
}

// =====================================================================================
// Tabela final
// =====================================================================================
export const MOVES: Record<MoveId, MoveData> = (() => {
  const out: Record<MoveId, MoveData> = {}
  const helds: Held[] = ['mao', ...WEAPON_IDS]
  const attackDirs: AttackDir[] = ['neutro', 'lado', 'baixo']
  const airDirs: AirDir[] = ['neutro', 'lado', 'baixo', 'cima']
  for (const h of helds) {
    for (const d of attackDirs) {
      const id = `${h}:${d}`
      out[id] = fromRow(id, LIGHT[h][d])
    }
    for (const d of airDirs) {
      const id = `${h}:ar-${d}`
      out[id] = fromRow(id, AIR[h][d], d === 'cima' ? { recovery_move: true } : {})
    }
  }
  for (const d of attackDirs) {
    const id = `mao:forte-${d}`
    out[id] = fromRow(id, HAND_HEAVY[d], { chargeable: true })
  }
  for (const c of CHARACTER_IDS) {
    for (const d of attackDirs) {
      for (const w of WEAPON_IDS) {
        const id = `${c}:${w}:${d}`
        out[id] = variant(SIGNATURES[c][d], id, w)
      }
    }
  }
  return out
})()

/** lista estável de ids (o codec guarda o índice); 0 fica livre para "sem golpe" */
export const MOVE_IDS: readonly MoveId[] = Object.keys(MOVES)
const MOVE_INDEX: Record<MoveId, number> = (() => {
  const o: Record<MoveId, number> = {}
  MOVE_IDS.forEach((id, i) => (o[id] = i + 1))
  return o
})()
export const moveIndex = (id: MoveId | null): number => (id === null ? 0 : (MOVE_INDEX[id] ?? 0))
export const moveById = (index: number): MoveId | null => (index <= 0 ? null : (MOVE_IDS[index - 1] ?? null))

/**
 * Golpe que a combinação pede. `kind`: 'leve' (chão), 'forte' (chão, assinatura ou genérico desarmado)
 * ou 'ar' (qualquer botão no ar). `dir` 'cima' só existe no ar.
 */
export function moveFor(char: CharacterId, held: Held, kind: 'leve' | 'forte' | 'ar', dir: AttackDir | AirDir): MoveData {
  if (kind === 'ar') return MOVES[`${held}:ar-${dir}`] ?? MOVES['mao:ar-neutro']
  const d: AttackDir = dir === 'cima' ? 'neutro' : dir
  if (kind === 'leve') return MOVES[`${held}:${d}`] ?? MOVES['mao:neutro']
  return (held === 'mao' ? MOVES[`mao:forte-${d}`] : MOVES[`${char}:${held}:${d}`]) ?? MOVES['mao:forte-neutro']
}

/** projétil de arma arremessada (kind 'arma') */
export const THROWN: Record<WeaponId, ProjectileSpec> = {
  vassoura: thrown(8, 3.2, 6),
  frigideira: thrown(13, 4.5, 8),
  luvas: thrown(6, 2.6, 5)
}
function thrown(damage: number, baseKb: number, kbGrowth: number): ProjectileSpec {
  return {
    kind: 'arma',
    count: 1,
    gapTicks: 0,
    x: 8,
    y: -18,
    vx: 6.5,
    vy: -2,
    w: 14,
    h: 14,
    lifeTicks: 45,
    pierce: false,
    hit: stats(damage, baseKb, kbGrowth, [0.85, -0.53])
  }
}
