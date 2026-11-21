import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react'
import type { GameId } from '../../../shared/games/protocol'
import { CATALOG_LIST, FILTERS, matchesFilter, type GameEntry, type ShelfFilter } from './catalog'
import { flipFrom, useChannelSurf, useReducedMotion, type FlipSource } from './motion'
import { THUMBS } from './thumbs'
import { TvFrame } from './TvFrame'

interface Props {
  filter: ShelfFilter
  onFilter: (f: ShelfFilter) => void
  onOpen: (id: GameId, tv: HTMLElement) => void
  /** vindo dos detalhes: a TV deste jogo anima a partir de onde estava */
  flipRef: MutableRefObject<FlipSource | null>
}

/** Vitrine: filtros em pílulas e a grade de cartões, cada um com a sua TV. */
export function GameShelf({ filter, onFilter, onOpen, flipRef }: Props) {
  const list = CATALOG_LIST.filter((e) => matchesFilter(e, filter))
  const grid = useRef<HTMLDivElement>(null)
  const flipId = flipRef.current?.id

  // voltando dos detalhes: a TV do cartão encolhe a partir da TV grande e o cartão recebe o foco
  useLayoutEffect(() => {
    const f = flipRef.current
    if (!f) return
    flipRef.current = null
    const card = grid.current?.querySelector<HTMLElement>(`[data-games-card="${f.id}"]`)
    if (!card) return
    card.scrollIntoView({ block: 'nearest' })
    card.focus({ preventScroll: true })
    const tv = card.querySelector<HTMLElement>('.games-tv')
    if (tv && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) flipFrom(tv, f.rect)
  }, [flipRef])

  // setas andam pela grade; cima e baixo vão para o cartão mais perto na fileira de cima ou de baixo
  const onKeyDown = (e: KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
    const cards = Array.from(grid.current?.querySelectorAll<HTMLElement>('[data-games-card]') ?? [])
    const at = cards.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    let to = at
    if (e.key === 'ArrowRight') to = Math.min(cards.length - 1, at + 1)
    else if (e.key === 'ArrowLeft') to = Math.max(0, at - 1)
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = cards.length - 1
    else {
      const here = cards[at]!.getBoundingClientRect()
      const dir = e.key === 'ArrowDown' ? 1 : -1
      const cand = cards
        .map((c, i) => {
          const r = c.getBoundingClientRect()
          return { i, dy: (r.top - here.top) * dir, dx: Math.abs(r.left + r.width / 2 - (here.left + here.width / 2)) }
        })
        .filter((c) => c.dy >= 8)
      if (cand.length) {
        const row = Math.min(...cand.map((c) => c.dy))
        to = cand.filter((c) => c.dy - row <= 8).sort((x, y) => x.dx - y.dx)[0]!.i
      }
    }
    e.preventDefault()
    e.stopPropagation()
    cards[to]?.focus()
  }

  return (
    <div className="games-shelf">
      <div className="games-filters" role="group" aria-label="Tipo de jogo">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`games-filter ${filter === f.id ? 'on' : ''}`} aria-pressed={filter === f.id} onClick={() => onFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {/* a chave refaz a entrada em cascata quando o filtro muda */}
      <div ref={grid} key={filter} className="games-grid" onKeyDown={onKeyDown}>
        {list.map((e, i) => (
          <GameCard key={e.id} entry={e} order={i} still={e.id === flipId} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}

function GameCard({ entry, order, still, onOpen }: { entry: GameEntry; order: number; still: boolean; onOpen: Props['onOpen'] }) {
  const [hot, setHot] = useState(false)
  const reduced = useReducedMotion()
  const frames = THUMBS[entry.id]
  const { index } = useChannelSurf(frames.length, hot, 1200, reduced)
  const tv = useRef<HTMLDivElement>(null)
  return (
    <button
      type="button"
      className={`games-card ${hot ? 'is-hot' : ''} ${still ? 'is-still' : ''}`}
      style={{ '--i': order } as React.CSSProperties}
      data-games-card={entry.id}
      aria-label={`${entry.name}. ${entry.line}. ${entry.people}, ${entry.time}${entry.bots ? ', com robôs' : ''}`}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
      onClick={() => tv.current && onOpen(entry.id, tv.current)}
    >
      <TvFrame ref={tv} id={entry.id} src={frames[index]} alt={`Print do ${entry.name}`} icon={entry.icon} channel={entry.channel} size="card" on={hot} />
      <span className="games-card-text">
        <span className="games-card-name">{entry.name}</span>
        <span className="games-card-line">{entry.line}</span>
      </span>
      <span className="games-tags" aria-hidden="true">
        <span>{entry.people}</span>
        <span>{entry.time}</span>
        {entry.bots && <span className="bots">com robôs</span>}
      </span>
    </button>
  )
}
