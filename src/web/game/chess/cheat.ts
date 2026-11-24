/**
 * Código secreto do xadrez (como truque de videogame): cima, cima, baixo, baixo, esquerda, direita
 * durante a partida libera o botão do tabuleiro realista. Puro: o teste importa daqui.
 */
export const CHEAT_KEYS = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const
/** pausa máxima entre uma tecla e a próxima */
export const CHEAT_GAP_MS = 2500

export interface CheatState {
  /** quantas teclas certas seguidas */
  n: number
  at: number
}

export const CHEAT_START: CheatState = { n: 0, at: 0 }

/** próximo estado; `n === CHEAT_KEYS.length` = liberou */
export function cheatStep(s: CheatState, key: string, now: number): CheatState {
  const n = s.n > 0 && now - s.at > CHEAT_GAP_MS ? 0 : s.n
  if (key === CHEAT_KEYS[n]) return { n: n + 1, at: now }
  // errou: "cima, cima, cima" ainda vale como o começo (as duas últimas)
  if (key === 'ArrowUp') return { n: n === 2 ? 2 : 1, at: now }
  return { n: 0, at: now }
}

export const cheatDone = (s: CheatState): boolean => s.n >= CHEAT_KEYS.length
