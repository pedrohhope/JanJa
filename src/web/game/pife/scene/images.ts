/** Imagens das cartas do pife: cada sprite vira um PNG (data: URL, a CSP aceita) uma vez só. */
import { rgba, type Sprite } from '../../art/palette'
import { artKey, backSprite, cardSprite } from './art'

const cache = new Map<string, string>()

function toUrl(s: Sprite): string {
  const w = s[0].length
  const h = s.length
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D
  const img = ctx.createImageData(w, h)
  s.forEach((line, y) =>
    [...line].forEach((ch, x) => {
      const [r, g, b, a] = rgba(ch)
      const i = (y * w + x) * 4
      img.data[i] = r
      img.data[i + 1] = g
      img.data[i + 2] = b
      img.data[i + 3] = a
    })
  )
  ctx.putImageData(img, 0, 0)
  return cv.toDataURL('image/png')
}

export function cardUrl(card: string): string {
  const k = artKey(card)
  let u = cache.get(k)
  if (!u) {
    u = toUrl(cardSprite(card))
    cache.set(k, u)
  }
  return u
}

export function backUrl(): string {
  let u = cache.get('back')
  if (!u) {
    u = toUrl(backSprite())
    cache.set('back', u)
  }
  return u
}
