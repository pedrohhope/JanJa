/** Descrição de uma pose, igual para os 4 personagens; cada `rig` sabe desenhá-la com o próprio corpo. */
export type Face = 'normal' | 'blink' | 'hurt' | 'effort' | 'win' | 'scared' | 'sleepy' | 'smug'

/** [dx, lift] de cada pé em relação ao quadril: dx para a frente, lift em px acima do chão */
export interface Legs {
  f: [number, number]
  b: [number, number]
}

export interface Pose {
  /** corpo inteiro mais baixo (agachado) */
  dy: number
  /** cabeça e ombros para a frente (+) ou para trás (-) */
  lean: number
  legs: Legs
  /** mão da frente e de trás, em relação ao ombro de cada uma */
  fh: [number, number]
  bh: [number, number]
  /** ângulo da arma (graus; 0 = frente, 90 = baixo, 270 = cima) */
  ang: number
  reach: number
  face: Face
  /** atraso do pompom/antena/vapor, em px */
  pomp: number
  /** contador de quadro (pisca LED, vapor, chiado) */
  t: number
  /** efeito pintado por cima, depois do contorno */
  ov?: string
  ovT?: number
  /** brilho de carga (0..1) */
  glow?: number
}

export const LEGS_STAND: Legs = { f: [1, 0], b: [-1, 0] }

export function basePose(over: Partial<Pose> = {}): Pose {
  return {
    dy: 0,
    lean: 0,
    legs: LEGS_STAND,
    fh: [0, 5],
    bh: [0, 5],
    ang: 300,
    reach: 0,
    face: 'normal',
    pomp: 0,
    t: 0,
    ...over
  }
}
