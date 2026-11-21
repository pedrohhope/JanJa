/**
 * Os 4 lutadores. Todos os números de movimento ficam aqui (px por tick, 60 Hz): ajuste sem medo.
 * Altura do pulo = v² / (2 * GRAVITY * gravityMul): jan ~74 px o do chão, ~62 px o do ar.
 */
import type { CharacterId, CharacterSpec } from './types'

export const CHARACTERS: Record<CharacterId, CharacterSpec> = {
  jan: {
    id: 'jan',
    name: 'Jan',
    tagline: 'Equilibrado. Dá as cartas.',
    weightClass: 'medio',
    kbMul: 1,
    runSpeed: 2.6,
    airAccel: 0.28,
    airMax: 2.4,
    jumpVel: 6.9,
    airJumpVel: 6.3,
    gravityMul: 1,
    fallMax: 6.5,
    fastFallMax: 10,
    hurtW: 18,
    hurtH: 30,
    likes: ['vassoura', 'frigideira']
  },
  xicara: {
    id: 'xicara',
    name: 'Xícara',
    tagline: 'Leve e rápida. Cuidado que queima.',
    weightClass: 'leve',
    kbMul: 1.15,
    runSpeed: 3.1,
    airAccel: 0.34,
    airMax: 2.9,
    jumpVel: 7.2,
    airJumpVel: 6.6,
    gravityMul: 0.92,
    fallMax: 6,
    fastFallMax: 9.5,
    hurtW: 16,
    hurtH: 26,
    likes: ['luvas', 'vassoura']
  },
  teve: {
    id: 'teve',
    name: 'Tevê',
    tagline: 'Pesada. Aguenta tudo, sai tarde.',
    weightClass: 'pesado',
    kbMul: 0.85,
    runSpeed: 2,
    airAccel: 0.2,
    airMax: 1.9,
    jumpVel: 6.5,
    airJumpVel: 5.9,
    gravityMul: 1.12,
    fallMax: 7.2,
    fastFallMax: 11,
    hurtW: 22,
    hurtH: 32,
    likes: ['frigideira']
  },
  janja: {
    id: 'janja',
    name: 'JanJa',
    tagline: 'Ágil. Compartilha tela e golpe.',
    weightClass: 'leve',
    kbMul: 1.05,
    runSpeed: 2.9,
    airAccel: 0.32,
    airMax: 2.7,
    jumpVel: 7,
    airJumpVel: 6.4,
    gravityMul: 0.96,
    fallMax: 6.3,
    fastFallMax: 9.8,
    hurtW: 17,
    hurtH: 29,
    likes: ['vassoura', 'luvas']
  }
}

/** Física comum que o contrato não fixa (o resto está em types.ts). */
export const TUNING = {
  /** zona morta do eixo, aplicada no sim */
  deadzone: 0.35,
  /** aceleração e atrito no chão (px/tick²) */
  groundAccel: 0.6,
  groundFriction: 0.5,
  /** fração do atrito/aceleração sobre café derramado (quase gelo) */
  puddleGrip: 0.07,
  /** sem direção no ar: a velocidade horizontal é multiplicada por isto por tick */
  airDrag: 0.97,
  /** velocidade máxima de qualquer corpo (evita atravessar plataformas) */
  maxSpeed: 28,
  /** esquiva: ao terminar, mantém esta fração da velocidade */
  dodgeExit: 0.3,
  /** pulo da parede empurra para longe a esta fração de airMax */
  wallJumpPush: 1.1,
  /** velocidade que mantém o lutador encostado na parede enquanto agarrado */
  wallPress: 0.4,
  /** queda de uma arma que cai do céu */
  itemGravity: 0.16,
  itemFallMax: 3,
  /** arma no chão some depois disto */
  itemLifeTicks: 1200,
  /** quanto de arma pode existir (caindo + no chão) */
  maxItems: 3,
  /** intervalo entre armas: 8 a 12 s */
  dropMinTicks: 480,
  dropSpanTicks: 241,
  /** alcance para pegar a arma */
  pickupReach: 16,
  /** o nocaute conta para quem bateu por último dentro desta janela */
  killerWindowTicks: 300,
  /** poças: no máximo, e intervalo entre poças de um mesmo golpe */
  maxPuddles: 6,
  puddleEvery: 3,
  /** quem voa em hitstun e bate na parede ou no chão volta com esta fração da velocidade */
  bounce: 0.6,
  /** pouso "duro" (som) acima desta velocidade de queda */
  hardLanding: 6
} as const
