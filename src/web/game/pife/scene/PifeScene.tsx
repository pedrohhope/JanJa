import '@fontsource-variable/pixelify-sans'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { bestMelds, cardName, findWin, sortCards, type Card } from '../../../../shared/games/pife/cards'
import type { PifeEvent } from '../../../../shared/games/pife/types'
import type { PifeSceneProps } from '../../contract'
import { seatSpot } from '../../truco/scene/layout'
import { backUrl, cardUrl } from './images'

const BUBBLE_MS = 2200

function CardImg({ card, w, className, label }: { card: Card | null; w: number; className?: string; label?: string }) {
  return (
    <img
      className={`pf-card ${className ?? ''}`}
      src={card ? cardUrl(card) : backUrl()}
      width={w}
      height={Math.round(w * 1.5)}
      alt={label ?? (card ? cardName(card) : 'Carta virada')}
      draggable={false}
    />
  )
}

/** Mantém a ordem que a pessoa arrumou: tira o que saiu da mão e põe o que entrou no fim. */
export function mergeOrder(prev: readonly Card[], hand: readonly Card[]): Card[] {
  const has = new Set(hand)
  const kept = prev.filter((c) => has.has(c))
  const seen = new Set(kept)
  return [...kept, ...hand.filter((c) => !seen.has(c))]
}

/** Ordem "organizada": os jogos prontos primeiro (cada um em ordem), depois as soltas por naipe. */
export function organize(hand: readonly Card[]): Card[] {
  const { melds, loose } = bestMelds(hand)
  return [...melds.flatMap((m) => sortCards(m)), ...sortCards(loose)]
}

/** Balões com o que cada um fez (pegou do lixo, bateu). */
function useBubbles(lastEvents: PifeSceneProps['lastEvents']): Record<number, string> {
  const [bubbles, setBubbles] = useState<Record<number, { text: string; at: number }>>({})
  const seen = useRef(lastEvents?.seq ?? -1)
  useEffect(() => {
    if (!lastEvents || lastEvents.seq === seen.current) return
    seen.current = lastEvents.seq
    const add: Record<number, { text: string; at: number }> = {}
    for (const ev of lastEvents.events as PifeEvent[]) {
      if (ev.type === 'draw' && ev.from === 'lixo' && ev.card) add[ev.p] = { text: `Peguei ${cardName(ev.card).toLowerCase()}`, at: Date.now() }
      if (ev.type === 'end') add[ev.winner] = { text: 'Bati!', at: Date.now() }
    }
    if (Object.keys(add).length) setBubbles((b) => ({ ...b, ...add }))
  }, [lastEvents])
  useEffect(() => {
    if (!Object.keys(bubbles).length) return
    const t = window.setTimeout(() => {
      const now = Date.now()
      setBubbles((b) => Object.fromEntries(Object.entries(b).filter(([, v]) => now - v.at < BUBBLE_MS)))
    }, 400)
    return () => window.clearTimeout(t)
  }, [bubbles])
  return Object.fromEntries(Object.entries(bubbles).map(([k, v]) => [k, v.text]))
}

/** Mesa do pife: placas em volta, monte e lixo no meio, a sua mão embaixo com os botões da vez. */
export function PifeScene({ view, lastEvents, reducedMotion, onAct }: PifeSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 800, h: 600 })
  const [order, setOrder] = useState<Card[]>(() => view.hand)
  const [sel, setSel] = useState<Card | null>(null)
  const [drag, setDrag] = useState<{ card: Card; x0: number; dx: number; moved: boolean } | null>(null)
  const bubbles = useBubbles(lastEvents)

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const fit = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])

  // a mão do servidor muda (comprou, descartou): mantém a sua arrumação
  const handKey = view.hand.join()
  useEffect(() => {
    setOrder((o) => mergeOrder(o, view.hand))
    setSel((s) => (s && view.hand.includes(s) ? s : null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handKey])
  useEffect(() => {
    if (view.phase === 'fim') setSel(null)
  }, [view.phase])

  const n = view.players.length
  const me = view.you?.index ?? 0
  const myTurn = !!view.you && view.turn === view.you.index
  const buying = myTurn && view.phase === 'comprar'
  const discarding = myTurn && view.phase === 'descartar'
  const fromLixo = view.took?.from === 'lixo' ? view.drawn : null
  const inMeld = useMemo(() => new Set(bestMelds(view.hand).melds.flat()), [handKey])
  const cw = Math.round(Math.max(44, Math.min(84, Math.min(box.w / 11, box.h * 0.12))))
  const small = Math.round(cw * 0.7)
  // sobreposição das cartas da mão para caber na largura
  const overlap = Math.min(cw * 0.15, Math.max(-cw * 0.55, (box.w - 32 - order.length * cw) / Math.max(1, order.length - 1)))

  const discard = (card: Card) => {
    if (!discarding || card === fromLixo) return
    onAct({ type: 'discard', card })
    setSel(null)
  }
  const bater = () => {
    if (!discarding || !view.canWin) return
    const withSel = sel && sel !== fromLixo && findWin(view.hand, sel) ? sel : undefined
    onAct(withSel ? { type: 'bater', discard: withSel } : { type: 'bater' })
  }

  // arrastar para reordenar
  const onDown = (e: RPointerEvent<HTMLButtonElement>, card: Card) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ card, x0: e.clientX, dx: 0, moved: false })
  }
  const onMove = (e: RPointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    const dx = e.clientX - drag.x0
    setDrag({ ...drag, dx, moved: drag.moved || Math.abs(dx) > 6 })
  }
  const onUp = (card: Card) => {
    const d = drag
    setDrag(null)
    if (!d) return
    if (!d.moved) {
      // clique: escolhe a carta; clicar de novo na escolhida descarta
      if (discarding && sel === card) return discard(card)
      return setSel(sel === card ? null : card)
    }
    const step = cw + overlap
    const from = order.indexOf(card)
    const to = Math.max(0, Math.min(order.length - 1, from + Math.round(d.dx / step)))
    if (to !== from) {
      const next = order.filter((c) => c !== card)
      next.splice(to, 0, card)
      setOrder(next)
    }
  }

  // teclado: 1 a 0 escolhem a carta, M monte, L lixo, D ou Enter descarta, B bate, O organiza
  const live = useRef({ order, sel, buying, discarding })
  live.current = { order, sel, buying, discarding }
  const actions = useRef({ discard, bater, onAct })
  actions.current = { discard, bater, onAct }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const l = live.current
      const k = e.key.toLowerCase()
      const digit = k === '0' ? 10 : Number(k)
      if (digit >= 1 && digit <= l.order.length) {
        e.preventDefault()
        setSel(l.order[digit - 1])
      } else if (k === 'm' && l.buying) actions.current.onAct({ type: 'draw', from: 'monte' })
      else if (k === 'l' && l.buying) actions.current.onAct({ type: 'draw', from: 'lixo' })
      else if ((k === 'd' || k === 'enter') && l.discarding && l.sel) {
        e.preventDefault()
        actions.current.discard(l.sel)
      } else if (k === 'b' && l.discarding) actions.current.bater()
      else if (k === 'o') setOrder(organize(l.order))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const winner = view.winner
  const lastLog = view.log[view.log.length - 1]

  return (
    <div className="pf-scene" ref={hostRef} style={{ '--cw': `${cw}px` } as CSSProperties}>
      <div className="tr-felt pf-felt" aria-hidden="true" />

      {view.players.map((pl) => {
        if (view.you && pl.index === me) return null
        const k = (pl.index - me + n) % n
        const seat = seatSpot(view.you ? k : pl.index, n)
        const acting = view.turn === pl.index
        const end = view.hands?.[pl.index]
        return (
          <div
            key={pl.playerId}
            className={`tr-plate pf-plate ${acting ? 'acting' : ''} ${winner?.p === pl.index ? 'won' : ''}`}
            style={{ left: `${Math.max(0.1, Math.min(seat.x, 0.9)) * 100}%`, top: `${Math.max(0.14, Math.min(seat.y, 0.7)) * 100}%` }}
          >
            <span className="tr-name">{pl.name}</span>
            <span className="tr-tags">
              <i>{pl.cards} cartas</i>
              {acting && <i className="tr-flor">{view.phase === 'comprar' ? 'comprando' : 'descartando'}</i>}
              {pl.away && <i>fora</i>}
            </span>
            {end ? (
              <span className="pf-mini-hand" aria-label={`Mão de ${pl.name}: ${end.map(cardName).join(', ')}`}>
                {sortCards(end).map((c) => (
                  <CardImg key={c} card={c} w={Math.round(cw * 0.32)} />
                ))}
              </span>
            ) : (
              <span className="tr-backs" aria-hidden="true">
                {Array.from({ length: Math.min(pl.cards, 10) }, (_, j) => (
                  <CardImg key={j} card={null} w={Math.round(cw * 0.3)} />
                ))}
              </span>
            )}
            {bubbles[pl.index] && (
              <span className="tr-bubble pixel-font" role="status">
                {bubbles[pl.index]}
              </span>
            )}
          </div>
        )
      })}

      <div className="pf-center">
        {winner ? (
          <div className="pf-win" aria-label={`${view.players[winner.p].name} bateu`}>
            <strong className="pixel-font">{view.you?.index === winner.p ? 'Você bateu!' : `${view.players[winner.p].name} bateu!`}</strong>
            <div className="pf-melds">
              {winner.melds.map((m, i) => (
                <span key={i} className="pf-meld">
                  {sortCards(m).map((c) => (
                    <CardImg key={c} card={c} w={small} />
                  ))}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="pf-piles">
            <button
              className={`pf-pile ${buying ? 'can' : ''}`}
              disabled={!buying}
              onClick={() => onAct({ type: 'draw', from: 'monte' })}
              aria-label={`Monte, ${view.stock} cartas${buying ? '. Comprar (M)' : ''}`}
              data-tip={buying ? 'Comprar do monte (M)' : undefined}
            >
              <CardImg card={null} w={cw} />
              <small>{view.stock}</small>
            </button>
            <button
              className={`pf-pile ${buying && view.top ? 'can' : ''} ${discarding && sel && sel !== fromLixo ? 'drop' : ''}`}
              disabled={!(buying && view.top) && !(discarding && sel && sel !== fromLixo)}
              onClick={() => (buying ? onAct({ type: 'draw', from: 'lixo' }) : sel && discard(sel))}
              aria-label={view.top ? `Lixo: ${cardName(view.top)}${buying ? '. Pegar (L)' : discarding && sel ? `. Descartar ${cardName(sel)}` : ''}` : 'Lixo vazio'}
              data-tip={buying && view.top ? 'Pegar do lixo (L)' : discarding && sel ? 'Descartar aqui' : undefined}
            >
              {view.top ? (
                <CardImg key={`${view.top}-${view.discards}`} card={view.top} w={cw} className={reducedMotion ? '' : 'pf-in'} />
              ) : (
                <span className="pf-empty" style={{ width: cw, height: cw * 1.5 }} />
              )}
              <small>lixo</small>
            </button>
          </div>
        )}
        {!winner && lastLog && <small className="pf-log">{lastLog}</small>}
      </div>

      {view.you && (
        <div className="pf-bottom">
          {!winner && (
            <div className="pf-actions">
              {buying && (
                <>
                  <button className="act primary" onClick={() => onAct({ type: 'draw', from: 'monte' })}>
                    Comprar do monte
                  </button>
                  <button className="act" disabled={!view.top} onClick={() => onAct({ type: 'draw', from: 'lixo' })}>
                    Pegar do lixo
                  </button>
                </>
              )}
              {discarding && (
                <>
                  <button className="act" disabled={!sel || sel === fromLixo} onClick={() => sel && discard(sel)}>
                    {sel ? (sel === fromLixo ? 'Essa veio do lixo' : `Descartar ${cardName(sel).toLowerCase()}`) : 'Escolha a carta para descartar'}
                  </button>
                  <button className={`act ${view.canWin ? 'primary' : ''}`} disabled={!view.canWin} onClick={bater}>
                    Bater
                  </button>
                </>
              )}
              <button className="act" onClick={() => setOrder(organize(order))} data-tip="Junta os jogos prontos e ordena o resto (O)">
                Organizar
              </button>
            </div>
          )}
          <div className={`pf-hand ${myTurn ? 'my-turn' : ''}`} aria-label="Suas cartas" style={{ '--ov': `${overlap}px` } as CSSProperties}>
            {order.map((c, j) => {
              const lifted = drag?.card === c && drag.moved
              return (
                <button
                  key={c}
                  className={`pf-hand-card ${sel === c ? 'sel' : ''} ${view.drawn === c ? 'new' : ''} ${inMeld.has(c) ? 'meld' : ''} ${lifted ? 'lifted' : ''}`}
                  style={lifted ? { transform: `translate(${drag.dx}px, -14px)` } : undefined}
                  onPointerDown={(e) => onDown(e, c)}
                  onPointerMove={onMove}
                  onPointerUp={() => onUp(c)}
                  onPointerCancel={() => setDrag(null)}
                  aria-pressed={sel === c}
                  aria-label={`${cardName(c)}${inMeld.has(c) ? ', faz jogo' : ''}${view.drawn === c ? ', acabou de comprar' : ''} (${j === 9 ? 0 : j + 1})`}
                >
                  <CardImg card={c} w={cw} label="" />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
