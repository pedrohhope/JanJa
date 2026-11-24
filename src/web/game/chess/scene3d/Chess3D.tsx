import { useEffect, useRef, useState } from 'react'
import { loadChunk } from '../../../version'
import type { Chess3DEngine, Chess3DProps } from './engine'

/**
 * Casca React do tabuleiro 3D: carrega o motor (e o Three.js) só quando a pessoa escolhe 3D,
 * acompanha o tamanho e repassa as props. `resetSeq` muda quando a pessoa pede a câmera de volta.
 * `look` = 'real' carrega o visual realista (outro pedaço). Para trocar de visual, troque a `key`.
 */
export function Chess3D({ size, resetSeq, look = 'pixel', ...props }: Chess3DProps & { size: number; resetSeq: number; look?: 'pixel' | 'real' }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Chess3DEngine | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let dead = false
    let ro: ResizeObserver | undefined
    const create: Promise<(host: HTMLElement) => Chess3DEngine> =
      look === 'real' ? loadChunk(() => import('./real')).then((m) => m.createRealEngine) : loadChunk(() => import('./engine')).then((m) => (host: HTMLElement) => new m.Chess3DEngine(host))
    void create.then((make) => {
      if (dead) return
      const eng = make(el)
      engineRef.current = eng
      if (import.meta.env.DEV) (window as unknown as { __chess3d: Chess3DEngine }).__chess3d = eng
      ro = new ResizeObserver(() => eng.resize(el.clientWidth, el.clientHeight))
      ro.observe(el)
      eng.resize(el.clientWidth, el.clientHeight)
      eng.setProps(propsRef.current)
      setReady(true)
    })
    return () => {
      dead = true
      ro?.disconnect()
      engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setProps(props)
  })

  useEffect(() => {
    if (resetSeq) engineRef.current?.resetView()
  }, [resetSeq])

  return (
    <div ref={hostRef} className="chess3d" style={{ width: size, height: size }}>
      {!ready && <span className="chess3d-loading pixel-font">{look === 'real' ? 'Polindo as peças...' : 'Montando o tabuleiro...'}</span>}
    </div>
  )
}
