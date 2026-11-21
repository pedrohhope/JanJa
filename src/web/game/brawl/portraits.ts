/**
 * Retratos em pixel art dos lutadores para o HUD (gerados dos sprites da cena num canvas pequeno,
 * como o HUD do tiro faz com `rowsToCanvas`). Cache por personagem, pose, arma, cor e escala.
 */
import type { CharacterId, Held } from '../../../shared/games/brawl/types'
import { buildSet, type AnimName } from './scene/anims'
import { BPAL } from './scene/palette'
import { rowsToBuf } from './scene/raster'
import type { WeaponId } from '../../../shared/games/brawl/types'
import { weaponRows } from './scene/items'

const cache = new Map<string, string>()

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

function boxOf(data: Uint8ClampedArray, w: number, h: number): Box {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3]! > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  return x1 < 0 ? { x0: 0, y0: 0, x1: w - 1, y1: h - 1 } : { x0, y0, x1, y1 }
}

function toUrl(rows: string[], pal: Record<string, string>, scale: number, crop: boolean): string {
  const buf = rowsToBuf(rows, pal)
  const b = crop ? boxOf(buf.data, buf.w, buf.h) : { x0: 0, y0: 0, x1: buf.w - 1, y1: buf.h - 1 }
  const w = b.x1 - b.x0 + 1
  const h = b.y1 - b.y0 + 1
  const small = document.createElement('canvas')
  small.width = w
  small.height = h
  const sctx = small.getContext('2d')!
  const img = sctx.createImageData(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = ((y + b.y0) * buf.w + x + b.x0) * 4
      img.data.set(buf.data.subarray(o, o + 4), (y * w + x) * 4)
    }
  sctx.putImageData(img, 0, 0)
  const cv = document.createElement('canvas')
  cv.width = w * scale
  cv.height = h * scale
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small, 0, 0, cv.width, cv.height)
  return cv.toDataURL()
}

/** retrato (data URL) do lutador numa pose; `tint` é a cor do contorno */
export function portraitUrl(char: CharacterId, tint: string, opts: { anim?: AnimName; frame?: number; held?: Held; scale?: number } = {}): string {
  const anim = opts.anim ?? 'idle'
  const frame = opts.frame ?? 0
  const held = opts.held ?? 'mao'
  const scale = opts.scale ?? 3
  const key = `${char}|${anim}|${frame}|${held}|${tint}|${scale}`
  const hit = cache.get(key)
  if (hit) return hit
  const set = buildSet(char, held)[anim]
  const rows = set[frame % set.length]!
  const url = toUrl(rows, { ...BPAL, t: tint, T: tint }, scale, true)
  cache.set(key, url)
  return url
}

/** ícone da arma (data URL) */
export function weaponIconUrl(w: WeaponId, scale = 2): string {
  const key = `arma|${w}|${scale}`
  const hit = cache.get(key)
  if (hit) return hit
  const url = toUrl(weaponRows(w), BPAL, scale, true)
  cache.set(key, url)
  return url
}
