/** Contas e textos do HUD da Briga na Sala (puros, sem React nem DOM: testáveis em Node). */
import { ARENAS } from '../../../shared/games/brawl/arenas'
import { MOVES } from '../../../shared/games/brawl/moves'
import {
  BOT_SLOT_BASE,
  DAMAGE_STAGES,
  type ArenaId,
  type BrawlPlayerView,
  type BrawlScoreLine,
  type CharacterSpec,
  type WeaponId
} from '../../../shared/games/brawl/types'
import type { MoveTimingFn } from './scene/animate'
import type { NetStatus } from './contract'

/** nome da cor de dano -> cor na tela (clara o bastante para o fundo café) */
export const DAMAGE_COLORS: Record<(typeof DAMAGE_STAGES)[number]['color'], string> = {
  branco: '#F3EBDD',
  amarelo: '#FFD84A',
  laranja: '#FF9A3C',
  vermelho: '#FF5A4A',
  vinho: '#D1456B'
}

/** faixa do dano (0 a 4) */
export function damageStage(damage: number): number {
  let s = 0
  for (let i = 0; i < DAMAGE_STAGES.length; i++) if (damage >= DAMAGE_STAGES[i]!.from) s = i
  return s
}

export const damageColor = (damage: number): string => DAMAGE_COLORS[DAMAGE_STAGES[damageStage(damage)]!.color]

/** a tabela real dos golpes para a cena animar (startup, ativo, recuperação) */
export const moveTiming: MoveTimingFn = (id) => {
  const m = MOVES[id]
  return m ? { startup: m.startup, active: m.active, recovery: m.recovery } : undefined
}

export const WEIGHT_LABEL: Record<CharacterSpec['weightClass'], string> = { leve: 'Leve', medio: 'Médio', pesado: 'Pesado' }
export const WEAPON_LABEL: Record<WeaponId, string> = { vassoura: 'Vassoura', frigideira: 'Frigideira', luvas: 'Luvas' }
export const ARENA_NAME: Record<ArenaId, string> = { estante: ARENAS.estante.name, telhado: ARENAS.telhado.name }

/** cores do time (0..3), no contorno do lutador e no HUD */
export const TEAM_COLORS = ['#FF7A6B', '#7FB7E6', '#6FD49B', '#FFC94A'] as const
export const TEAM_NAMES = ['Time coral', 'Time azul', 'Time verde', 'Time amarelo'] as const
/** robôs sem time usam estas cores */
export const BOT_COLORS = ['#7E9CB5', '#C27C8E', '#8FAE6B', '#D4A373'] as const

/**
 * Cor do contorno por slot: com times, a do time; senão a do jogador (a mesma da sala) e a dos robôs.
 * `toneOf` entra por parâmetro para não puxar o React para cá.
 */
export function brawlColors(players: readonly BrawlPlayerView[], teamSize: number, toneOf: (name: string) => string): Record<number, string> {
  const out: Record<number, string> = {}
  for (const p of players) {
    out[p.slot] = teamSize > 0 ? TEAM_COLORS[p.team % TEAM_COLORS.length]! : p.bot ? BOT_COLORS[(p.slot - BOT_SLOT_BASE + BOT_COLORS.length) % BOT_COLORS.length]! : toneOf(p.name)
  }
  return out
}

export function brawlNames(players: readonly BrawlPlayerView[]): Record<number, string> {
  const out: Record<number, string> = {}
  for (const p of players) out[p.slot] = p.name
  return out
}

/** texto do status da rede, curto */
export function netLabel(net: NetStatus, pingMs: number): string {
  switch (net) {
    case 'conectando':
      return 'Conectando…'
    case 'p2p':
      return pingMs > 0 ? `Ligação direta, ${Math.round(pingMs)} ms` : 'Ligação direta'
    case 'relay':
      return pingMs > 0 ? `Pelo servidor, ${Math.round(pingMs)} ms` : 'Pelo servidor'
    case 'trocando-host':
      return 'Trocando de host…'
    case 'host':
      return 'Luta no seu computador'
    case 'offline':
      return 'Sem conexão'
  }
}

/** pódio: 1º, 2º e 3º; o resto em lista */
export function podiumOf<T>(ranking: readonly T[]): { top: T[]; rest: T[] } {
  return { top: ranking.slice(0, 3), rest: ranking.slice(3) }
}

/**
 * Slots vencedores no fim: o 1º do ranking e, nos times, todo o time dele.
 * `ranking` vem do coordenador (`BrawlScoreLine.id` = playerId ou `bot-N`).
 */
export function winnerSlots(ranking: readonly BrawlScoreLine[] | null, players: readonly BrawlPlayerView[], teamSize: number): number[] {
  const first = ranking?.[0]
  if (!first) return []
  const p = players.find((x) => x.id === first.id)
  if (!p) return []
  return teamSize > 0 ? players.filter((x) => x.team === p.team).map((x) => x.slot) : [p.slot]
}

/** ms de uma contagem 3, 2, 1: devolve o número a mostrar ou null */
export function countdownNumber(goTick: number, tick: number, hz = 60): number | null {
  const left = goTick - tick
  return left > 0 ? Math.ceil(left / hz) : null
}

/** acontece em `escolha`: segundos que faltam */
export const pickSecondsLeft = (pickEndsAt: number, now: number): number => Math.max(0, Math.ceil((pickEndsAt - now) / 1000))

/** próxima posição na lista de personagens (volta ao início) */
export const cycle = (i: number, dir: -1 | 1, n: number): number => (((i + dir) % n) + n) % n
