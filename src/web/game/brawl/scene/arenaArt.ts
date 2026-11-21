/** Entrada das artes de arena: monta cada uma uma vez e compõe quadros (para o preview e para a cena). */
import type { ArenaId } from '../../../../shared/games/brawl/types'
import { CALM_ENV, type AnimElem, type ArenaArt, type Env } from './arenaCommon'
import { buildEstante } from './estante'
import { Buf } from './raster'
import { buildTelhado } from './telhado'

export { CALM_ENV }
export type { AnimElem, ArenaArt, Env }

const built = new Map<ArenaId, ArenaArt>()

export function buildArena(id: ArenaId): ArenaArt {
  let a = built.get(id)
  if (!a) {
    a = id === 'estante' ? buildEstante() : buildTelhado()
    built.set(id, a)
  }
  return a
}

/** textura de um elemento no estado `key`, em cache por elemento */
const elemCache = new WeakMap<AnimElem, Map<number, Buf>>()
export function elemBuf(el: AnimElem, t: number, env: Env, key: number): Buf {
  let m = elemCache.get(el)
  if (!m) elemCache.set(el, (m = new Map()))
  let b = m.get(key)
  if (!b) {
    b = new Buf(el.w, el.h)
    el.paint(b, t, env, key)
    if (m.size > 120) m.clear()
    m.set(key, b)
  }
  return b
}

/** compõe tudo (menos lutadores) no instante `t` (ms): o que o jogo mostra por baixo dos lutadores, ou por cima com `withFront` */
export function composeArena(art: ArenaArt, t: number, env: Env = CALM_ENV, withFront = true): Buf {
  const out = new Buf(480, 270)
  out.rect(0, 0, 480, 270, art.wall)
  out.blit(art.far, 0, 0)
  const draw = (layer: 'far' | 'back') => {
    for (const el of art.anims) {
      if (el.layer !== layer) continue
      const p = el.pos(t, env)
      if (!p) continue
      out.blit(elemBuf(el, t, env, el.key(t, env)), Math.round(p.x), Math.round(p.y))
    }
  }
  draw('far')
  out.blit(art.back, 0, 0)
  draw('back')
  if (withFront) {
    out.blit(art.front, 0, 0)
    for (const el of art.anims) {
      if (el.layer !== 'front') continue
      const p = el.pos(t, env)
      if (p) out.blit(elemBuf(el, t, env, el.key(t, env)), Math.round(p.x), Math.round(p.y))
    }
  }
  return out
}
