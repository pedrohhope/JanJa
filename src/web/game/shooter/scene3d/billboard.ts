/**
 * Bonecos estilo Doom: o mesmo corpo 16x16 do 2D (`bodyRows`) mais o braço e a arma, desenhados num
 * quadro que muda conforme o lado em que você enxerga a pessoa. Puro: sem three e sem DOM.
 *
 * Quadro: BILLBOARD_W x BILLBOARD_H (32x16). A base (pés) fica na última linha e o centro do corpo
 * na coluna 16 (o corpo ocupa as colunas 8..23); o espaço dos lados é para a arma de perfil.
 */
import { Grid, flipH } from '../../art/grid'
import type { WeaponId } from '../../../../shared/games/shooter/types'
import type { Rows } from '../scene/palette'
import { ARM, WEAPON_ART, bodyRows, facingOf, type Facing } from '../scene/sprites'

export const BILLBOARD_W = 32
export const BILLBOARD_H = 16
/** coluna do corpo no quadro (o corpo 16x16 começa aqui) */
export const BODY_X = 8

/**
 * Lado em que a pessoa aparece para quem olha. Câmera em (viewerX, viewerY) olhando para ela;
 * o alvo está em (px, py) e mira para (ax, ay). Mundo com y para baixo.
 *  - mira para você: 'baixo' (de frente); mira para longe: 'cima' (de costas);
 *  - mira para a direita da tela: 'dir'; para a esquerda: 'esq'.
 * Com a câmera olhando na direção f, a direita da tela é (-fy, fx).
 */
export function facing3d(viewerX: number, viewerY: number, px: number, py: number, ax: number, ay: number): Facing {
  let fx = px - viewerX
  let fy = py - viewerY
  const l = Math.hypot(fx, fy)
  if (l < 1e-6) return 'baixo'
  fx /= l
  fy /= l
  const sideways = ax * -fy + ay * fx // componente na direita da tela
  const towardViewer = -(ax * fx + ay * fy) // positivo = mirando para a câmera
  return facingOf(sideways, towardViewer)
}

function put(g: Grid, x: number, y: number, rows: Rows): void {
  g.blit(x, y, rows)
}

const cache = new Map<string, Rows>()

/**
 * Corpo com braço e arma, BILLBOARD_W x BILLBOARD_H. `walkFrame` 0..2 como em `bodyRows`.
 * Letras da paleta do tiro; `t`/`T` são a tinta do jogador.
 */
export function bodyFrame3d(facing: Facing, weapon: WeaponId, walkFrame: number): Rows {
  const key = `${facing}|${weapon}|${walkFrame}`
  const hit = cache.get(key)
  if (hit) return hit
  let out: Rows
  if (facing === 'esq') out = flipH(bodyFrame3d('dir', weapon, walkFrame))
  else {
    const g = new Grid(BILLBOARD_W, BILLBOARD_H)
    const art = WEAPON_ART[weapon]
    const body = bodyRows(facing, walkFrame)
    if (facing === 'dir') {
      // de perfil: braço esticado para a frente e a arma apontando para o lado
      const ax = BODY_X + 7
      const ay = 8
      put(g, BODY_X, 0, body)
      put(g, ax, ay, ARM)
      put(g, ax + 4 - art.gripX, ay - art.gripY + 1, art.rows)
    } else if (facing === 'baixo') {
      // de frente: arma curta apontada para você, na mão do lado direito da tela
      put(g, BODY_X, 0, body)
      const long = weapon !== 'pistola'
      const w = long ? 4 : 3
      const x = BODY_X + 12
      g.rect(x, 9, w, long ? 4 : 3, 'k')
      g.rect(x + 1, 10, w - 2, long ? 2 : 1, weapon === 'rolha' ? 'O' : weapon === 'escopeta' ? 'N' : 'D')
      g.set(x + (w >> 1), long ? 12 : 11, 'k')
      // antebraço
      g.rect(BODY_X + 12, 8, 2, 2, 't')
      g.set(BODY_X + 12, 9, 'T')
    } else {
      // de costas: o corpo na frente e só um pedaço do braço e da ponta da arma
      put(g, BODY_X, 0, body)
      g.rect(BODY_X + 12, 8, 2, 3, 't')
      g.set(BODY_X + 13, 10, 'T')
      g.rect(BODY_X + 13, 11, 2, 1, 'k')
    }
    out = g.toSprite()
  }
  cache.set(key, out)
  return out
}
