/**
 * Paleta da Briga na Sala: "TV da sala à noite" (café, abajur, papel, poeira, coral, verde LED).
 * Reaproveita o SPAL do Tiro na Sala (uma letra = uma cor, `.` = transparente) e acrescenta o que a luta precisa.
 * `t` é a tinta do lutador (o contorno): a cena troca pela cor do time/jogador em tempo de execução.
 */
import { SPAL } from '../../shooter/scene/palette'

export const BPAL: Record<string, string> = {
  ...SPAL,
  t: '#FFFFFF',
  T: '#B4B4B4',
  A: '#E8D5A8', // palha clara (vassoura)
  H: '#FFD9C2', // brilho de pele
  J: '#5F4A3A', // cabelo escuro
  K: '#C23B2E', // vermelho vivo
  Q: '#A08968', // palha escura
  U: '#9FB4D9', // azul-lua
  X: '#2C3A5E', // azul noite
  Z: '#1B2440' // azul noite escuro
}

export const BPAL_KEYS = new Set(['.', ...Object.keys(BPAL)])

/** as cores de identidade, como 0xRRGGBB (usadas nas artes de arena e nos efeitos) */
export const C = {
  cafe: 0x221c19,
  cafe2: 0x2e2622,
  cafe3: 0x3b312c,
  piso: 0x4a3e37,
  piso2: 0x5e5048,
  concreto: 0x7a6c60,
  papel: 0xf3ebdd,
  papel2: 0xd9ccb8,
  poeira: 0xb7a99a,
  poeira2: 0x8b7e70,
  abajur: 0xffc94a,
  abajur2: 0xe0a92e,
  brilho: 0xffe9a6,
  coral: 0xff7a6b,
  coral2: 0xd9594b,
  vinho: 0x6e2a24,
  led: 0x6fd49b,
  led2: 0x3fa070,
  preto: 0x0f0b09
} as const

/** cores de jogador padrão (contorno), quando a sala não manda */
export const FALLBACK_COLORS = ['#FF7A6B', '#FFC94A', '#6FD49B', '#7FB7E6', '#E58AC4', '#B9A4F0', '#F3EBDD', '#E8A05A', '#9AD0C2', '#D9594B', '#C9D86B', '#8FA7F2']

export const hexNum = (c: string): number => parseInt(c.replace('#', ''), 16)

/** cor de contorno legível sobre o fundo escuro: sobe o brilho se estiver escura demais */
export function legibleTint(hex: string): string {
  const n = hexNum(hex)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  if (lum >= 95) return hex
  const k = Math.min(3, 110 / Math.max(lum, 8))
  const f = (v: number) => Math.min(255, Math.round(v * k + 22))
  return `#${((f(r) << 16) | (f(g) << 8) | f(b)).toString(16).padStart(6, '0')}`
}
