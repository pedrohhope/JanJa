import { useCallback, useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/** true quando a pessoa pediu menos movimento (acompanha mudanças) */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(QUERY)
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/**
 * Passa os quadros de um jogo como quem zapeia canais: troca a cada `every` ms enquanto `playing`.
 * Parado (ou com "reduzir movimento") fica no primeiro quadro. `resetKey` (o jogo) volta ao primeiro.
 */
export function useChannelSurf(count: number, playing: boolean, every: number, reduced: boolean, resetKey = ''): { index: number; go: (i: number) => void } {
  const [st, setSt] = useState({ k: resetKey, i: 0 })
  // escolher um quadro à mão reinicia o relógio
  const [bump, setBump] = useState(0)
  const live = playing && !reduced && count > 1
  useEffect(() => {
    if (!live) setSt({ k: resetKey, i: 0 })
  }, [live, resetKey])
  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => setSt((s) => ({ k: resetKey, i: ((s.k === resetKey ? s.i : 0) + 1) % count })), every)
    return () => window.clearInterval(t)
  }, [live, count, every, bump, resetKey])
  const go = useCallback(
    (i: number) => {
      setSt({ k: resetKey, i })
      setBump((b) => b + 1)
    },
    [resetKey]
  )
  const index = st.k === resetKey ? st.i : 0
  return { index: Math.min(index, Math.max(0, count - 1)), go }
}

/**
 * FLIP: anima `el` a partir do retângulo `from` (onde ele estava) até onde está agora, só com transform.
 * Devolve a animação (ou null quando não precisa).
 */
export function flipFrom(el: HTMLElement, from: DOMRect, duration = 340): Animation | null {
  const to = el.getBoundingClientRect()
  if (!to.width || !to.height || !el.animate) return null
  const dx = from.left - to.left
  const dy = from.top - to.top
  const sx = from.width / to.width
  const sy = from.height / to.height
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) return null
  el.classList.add('is-flipping')
  const anim = el.animate(
    [
      { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: 'top left', transform: 'none' }
    ],
    { duration, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
  )
  const done = () => el.classList.remove('is-flipping')
  anim.onfinish = done
  anim.oncancel = done
  return anim
}

/** guarda o canto de uma TV para o próximo painel animar a partir dele */
export interface FlipSource {
  id: string
  rect: DOMRect
}
