import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import type { GameId } from '../../../shared/games/protocol'
import { Icon, type IconName } from '../icons'

let noiseCache: string | null = null

/** Chiado de TV desenhado em código: um canvas pequeno de ruído, esticado sem suavizar. */
export function noiseUrl(): string {
  if (noiseCache !== null) return noiseCache
  noiseCache = ''
  if (typeof document === 'undefined') return noiseCache
  try {
    const c = document.createElement('canvas')
    c.width = 120
    c.height = 68
    const ctx = c.getContext('2d')
    if (!ctx) return noiseCache
    const img = ctx.createImageData(c.width, c.height)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 70 + Math.floor(Math.random() * 185)
      // papel quente em vez de cinza frio, combina com a sala
      img.data[i] = v
      img.data[i + 1] = Math.round(v * 0.94)
      img.data[i + 2] = Math.round(v * 0.86)
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    noiseCache = c.toDataURL('image/png')
  } catch {
    noiseCache = ''
  }
  return noiseCache
}

interface Props {
  id: GameId
  /** quadro atual (URL do print) */
  src: string | undefined
  alt: string
  icon: IconName
  /** número do canal, "canal 03" */
  channel: number
  size: 'card' | 'big' | 'mini'
  /** TV "ligada mais forte" (hover, foco, detalhes) */
  on?: boolean
  /** em andamento: mostra "ao vivo" */
  liveBadge?: boolean
  children?: React.ReactNode
}

/** A moldura de TV de tubo: tela com o print, chiado entre os quadros, varredura e vidro. Só CSS. */
export const TvFrame = forwardRef<HTMLDivElement, Props>(function TvFrame({ id, src, alt, icon, channel, size, on, liveBadge, children }, ref) {
  const [flash, setFlash] = useState(0)
  const [dead, setDead] = useState<Set<string>>(() => new Set())
  const first = useRef(true)
  const noise = useMemo(() => noiseUrl(), [])

  // cada troca de quadro ou de jogo dá um relance de chiado (a animação é em CSS e some com "reduzir movimento")
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setFlash((n) => n + 1)
  }, [src, id])

  const broken = !src || dead.has(src)
  const ch = String(channel).padStart(2, '0')

  return (
    <div ref={ref} className={`games-tv games-tv-${size} ${on ? 'is-on' : ''} ${broken ? 'is-dead' : ''}`} data-games-tv={id}>
      <div className="games-tv-body">
        <div className="games-tv-screen">
          {src && !broken && (
            <img
              key={src}
              className="games-tv-img"
              src={src}
              alt={alt}
              width={640}
              height={360}
              draggable={false}
              decoding="async"
              onError={() => setDead((d) => new Set(d).add(src))}
            />
          )}
          {broken && (
            <div className="games-tv-lost" role="img" aria-label={alt}>
              <Icon name={icon} size={size === 'big' ? 56 : size === 'card' ? 36 : 24} />
            </div>
          )}
          <div className="games-tv-noise-base" style={noise ? { backgroundImage: `url(${noise})` } : undefined} aria-hidden="true" />
          {flash > 0 && <div key={flash} className="games-tv-noise" style={noise ? { backgroundImage: `url(${noise})` } : undefined} aria-hidden="true" />}
          <div className="games-tv-scan" aria-hidden="true" />
          <div className="games-tv-glass" aria-hidden="true" />
          {liveBadge && (
            <span className="games-live">
              <i aria-hidden="true" />
              ao vivo
            </span>
          )}
          {children}
        </div>
        <div className="games-tv-panel" aria-hidden="true">
          <span className="games-tv-ch pixel-font">canal {ch}</span>
          <span className="games-tv-grille" />
          <span className="games-tv-knob" />
          <span className="games-tv-knob" />
          <span className="games-tv-led" />
        </div>
      </div>
    </div>
  )
})
