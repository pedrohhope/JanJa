/**
 * Texturas do Tiro na Sala em 3D (canvas 2D, sem three). Implementa `TextureApi` do contrato, com cache.
 * `floorCanvas` e `topCanvas` cobrem o mapa todo (w*16 x h*16 px), com a linha 0 do canvas em z = 0 (ver world.ts).
 * No 3D a sombra vem da luz, então a sombra da parede (`wallAbove`) fica desligada.
 */
import type { MapDef, MapId } from '../../../../shared/games/shooter/types'
import { tileContext } from '../scene/mapart'
import { SPAL, rowsToCanvas, shade, type Rows } from '../scene/palette'
import { TILE_PX, tileRows, type TileCtx } from '../scene/tiles'
import type { TextureApi } from './contract3d'
import { PROP_3D, capRows, ceilingRows, sideRows, waterRows } from './props3d'

const rgbCache = new Map<string, [number, number, number]>()
function rgb(ch: string): [number, number, number] | null {
  const hit = rgbCache.get(ch)
  if (hit) return hit
  const hex = SPAL[ch]
  if (!hex) return null
  const v: [number, number, number] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
  rgbCache.set(ch, v)
  return v
}

/** desenha as linhas de um tile (`.` fica transparente) no ImageData do mapa */
function blit(img: ImageData, width: number, rows: Rows, tx: number, ty: number): void {
  for (let y = 0; y < TILE_PX; y++)
    for (let x = 0; x < TILE_PX; x++) {
      const col = rgb(rows[y]![x]!)
      if (!col) continue
      const o = ((ty * TILE_PX + y) * width + tx * TILE_PX + x) * 4
      img.data[o] = col[0]
      img.data[o + 1] = col[1]
      img.data[o + 2] = col[2]
      img.data[o + 3] = 255
    }
}

function mapCanvas(map: MapDef, draw: (img: ImageData, width: number) => void): HTMLCanvasElement {
  const width = map.w * TILE_PX
  const height = map.h * TILE_PX
  const cv = document.createElement('canvas')
  cv.width = width
  cv.height = height
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(width, height)
  draw(img, width)
  ctx.putImageData(img, 0, 0)
  return cv
}

const noShadow = (c: TileCtx): TileCtx => ({ ...c, wallAbove: false })
/** o piso de baixo de um móvel é desenhado como miolo de um bloco enorme (o padrão segue a posição global) */
const asFloor = (c: TileCtx): TileCtx => ({ ...c, wallAbove: false, bx: 100, by: 100, bw: 200, bh: 200, nl: true, nr: true, nu: true, nd: true })

const floors = new WeakMap<MapDef, HTMLCanvasElement>()
const tops = new WeakMap<MapDef, HTMLCanvasElement>()
const sides = new Map<string, HTMLCanvasElement>()
let ceiling: HTMLCanvasElement | null = null
let water: HTMLCanvasElement | null = null
let sky: HTMLCanvasElement | null = null

export function floorCanvas(map: MapDef): HTMLCanvasElement {
  const hit = floors.get(map)
  if (hit) return hit
  const cv = mapCanvas(map, (img, width) => {
    for (let ty = 0; ty < map.h; ty++)
      for (let tx = 0; tx < map.w; tx++) {
        const { ref, ctx } = tileContext(map, tx, ty)
        const shape = PROP_3D[ref.art]?.shape
        let rows: Rows
        if (ref.art === 'parede') rows = tileRows('parede', noShadow(ctx))
        else if (shape === 'flat') rows = tileRows(ref.art, noShadow(ctx))
        else rows = tileRows(ref.floor ?? 'piso-madeira', asFloor(ctx))
        blit(img, width, rows, tx, ty)
      }
  })
  floors.set(map, cv)
  return cv
}

export function topCanvas(map: MapDef): HTMLCanvasElement {
  const hit = tops.get(map)
  if (hit) return hit
  const cap = capRows()
  const cv = mapCanvas(map, (img, width) => {
    for (let ty = 0; ty < map.h; ty++)
      for (let tx = 0; tx < map.w; tx++) {
        const { ref, ctx } = tileContext(map, tx, ty)
        const shape = PROP_3D[ref.art]?.shape
        if (ref.art === 'parede') {
          // casa tem teto: a tampa do muro só aparece no quintal
          if (map.id === 'quintal') blit(img, width, cap, tx, ty)
        } else if (shape === 'box') blit(img, width, tileRows(ref.art, noShadow(ctx)), tx, ty)
      }
  })
  tops.set(map, cv)
  return cv
}

export function sideCanvas(art: string, mapId: MapId): HTMLCanvasElement {
  const key = `${mapId}:${art}`
  let cv = sides.get(key)
  if (!cv) sides.set(key, (cv = rowsToCanvas(sideRows(art, mapId))))
  return cv
}

export function ceilingCanvas(): HTMLCanvasElement {
  return (ceiling ??= rowsToCanvas(ceilingRows()))
}

export function waterCanvas(): HTMLCanvasElement {
  return (water ??= rowsToCanvas(waterRows()))
}

/** céu noturno discreto: do alto (azul poeirento escuro) ao horizonte (café), 4 x 128 */
export function skyCanvas(): HTMLCanvasElement {
  if (sky) return sky
  const cv = document.createElement('canvas')
  cv.width = 4
  cv.height = 128
  const ctx = cv.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0, shade(SPAL.V!, 0.4))
  g.addColorStop(0.55, shade(SPAL.V!, 0.62))
  g.addColorStop(0.85, SPAL.r!)
  g.addColorStop(1, SPAL.e!)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 128)
  return (sky = cv)
}

// confere o contrato em tempo de compilação
const _api: TextureApi = { floorCanvas, topCanvas, sideCanvas, ceilingCanvas, waterCanvas, skyCanvas }
void _api
