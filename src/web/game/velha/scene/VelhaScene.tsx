import { useState, type KeyboardEvent, type ReactElement } from 'react'
import { boardName, spotName, type Mark } from '../../../../shared/games/velha/rules'
import { markOf } from '../../../../shared/games/velha/types'
import type { VelhaSceneProps } from '../../contract'
import { DuelFrame, type SideNames } from '../../duel/DuelFrame'
import { MARK_PX, markRuns } from './pixel'

/** tamanho de uma casinha, do vão entre tabuleiros e da borda (unidades do SVG) */
const CELL = 10
const GAP = 4
const PAD = 3
const SMALL = CELL * 3
const BOARD = 2 * PAD + 3 * SMALL + 2 * GAP

const SIDES: SideNames = { w: 'X', b: 'O' }
const COLORS = {
  bg: '#2E2622',
  panel: '#3B312C',
  open: '#463A33',
  line: '#5A4C43',
  lamp: '#FFC94A',
  dim: '#221C19'
}

/** canto de cima à esquerda do tabuleiro pequeno `b` */
const boardX = (b: number) => PAD + (b % 3) * (SMALL + GAP)
const boardY = (b: number) => PAD + Math.floor(b / 3) * (SMALL + GAP)
const cellX = (b: number, c: number) => boardX(b) + (c % 3) * CELL
const cellY = (b: number, c: number) => boardY(b) + Math.floor(c / 3) * CELL

/** casa na posição (x, y) da grade 9x9 */
const fromGrid = (x: number, y: number) => ({ board: Math.floor(y / 3) * 3 + Math.floor(x / 3), cell: (y % 3) * 3 + (x % 3) })

/** marca em pixel art com o canto em (x, y), `px` unidades por pixel */
function MarkArt({ m, x, y, px, opacity = 1, className }: { m: Mark; x: number; y: number; px: number; opacity?: number; className?: string }): ReactElement {
  return (
    <g transform={`translate(${x} ${y}) scale(${px})`} opacity={opacity}>
      {/* a animação fica num grupo de dentro: no de fora ela brigaria com o transform da posição */}
      <g className={className}>
        {markRuns(m).map((r) => (
          <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
        ))}
      </g>
    </g>
  )
}

/** Velha ao quadrado: tabuleiro grande com nove pequenos, placas e relógios em volta (DuelFrame). */
export function VelhaScene({ view, colors, reducedMotion, onMove }: VelhaSceneProps) {
  const [hover, setHover] = useState<{ board: number; cell: number } | null>(null)
  const [cursor, setCursor] = useState({ x: 4, y: 4 })
  const [focused, setFocused] = useState(false)
  const myTurn = !!view.you && !view.result && view.turn === view.you.color
  const legal = new Set(view.legal.map(([b, c]) => b * 9 + c))
  const isLegal = (b: number, c: number) => legal.has(b * 9 + c)
  const mine: Mark | null = view.you ? markOf(view.you.color) : null
  const last = view.lastMove
  /** tabuleiros onde quem joga pode jogar agora */
  const playable = new Set(
    view.result ? [] : view.forced !== null ? [view.forced] : view.small.flatMap((s, b) => (s === null ? [b] : []))
  )

  const play = (b: number, c: number) => {
    if (myTurn && isLegal(b, c)) onMove(b, c)
  }

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (d[e.key] || e.key === 'Enter' || e.key === ' ') setFocused(true)
    if (d[e.key]) {
      e.preventDefault()
      setCursor({ x: Math.min(8, Math.max(0, cursor.x + d[e.key][0])), y: Math.min(8, Math.max(0, cursor.y + d[e.key][1])) })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const { board, cell } = fromGrid(cursor.x, cursor.y)
      play(board, cell)
    }
  }

  const cur = fromGrid(cursor.x, cursor.y)
  const curMark = view.board[cur.board][cur.cell]
  const youLabel = mine ? `Você joga de ${mine === 'x' ? 'X' : 'O'}.` : 'Você está assistindo.'
  const where = view.result ? '' : view.forced !== null ? `Vale o ${boardName(view.forced)}.` : 'Vale qualquer tabuleiro aberto.'
  const ghost = myTurn && hover && isLegal(hover.board, hover.cell) ? hover : null
  const wl = view.winLine
  const center = (b: number) => ({ x: boardX(b) + SMALL / 2, y: boardY(b) + SMALL / 2 })

  return (
    <DuelFrame
      view={view}
      colors={colors}
      sideNames={SIDES}
      captured={(side) => {
        const n = view.small.filter((s) => s === markOf(side)).length
        return n ? <span className="velha-count">{n === 1 ? '1 tabuleiro' : `${n} tabuleiros`}</span> : null
      }}
    >
      {(size) => (
        <>
          <svg
            className={`chess-board velha-board ${myTurn ? 'my-turn' : ''}`}
            viewBox={`0 0 ${BOARD} ${BOARD}`}
            width={size}
            height={size}
            shapeRendering="crispEdges"
            tabIndex={0}
            role="application"
            aria-label={`Velha ao quadrado. ${youLabel} ${where} Setas andam pelas casas e Enter joga.`}
            onKeyDown={onKey}
            onFocus={(e) => setFocused(e.currentTarget.matches(':focus-visible'))}
            onBlur={() => setFocused(false)}
            onPointerLeave={() => setHover(null)}
          >
            <rect x={0} y={0} width={BOARD} height={BOARD} fill={COLORS.bg} />
            {view.small.map((s, b) => {
              const on = playable.has(b)
              const bx = boardX(b)
              const by = boardY(b)
              return (
                <g key={b}>
                  <rect x={bx} y={by} width={SMALL} height={SMALL} fill={on ? COLORS.open : COLORS.panel} />
                  {/* linhas do jogo da velha pequeno */}
                  {[1, 2].map((k) => (
                    <g key={k} fill={COLORS.line}>
                      <rect x={bx + k * CELL - 0.25} y={by + 1.5} width={0.5} height={SMALL - 3} />
                      <rect x={bx + 1.5} y={by + k * CELL - 0.25} width={SMALL - 3} height={0.5} />
                    </g>
                  ))}
                  {/* casas: clique */}
                  {view.board[b].map((m, c) => {
                    const x = cellX(b, c)
                    const y = cellY(b, c)
                    const isLast = last && last.board === b && last.cell === c
                    const can = myTurn && isLegal(b, c)
                    return (
                      <g key={c}>
                        {isLast && <rect x={x + 0.5} y={y + 0.5} width={CELL - 1} height={CELL - 1} fill={COLORS.lamp} opacity={0.22} />}
                        {m && (
                          <MarkArt
                            m={m}
                            x={x + (CELL - MARK_PX) / 2}
                            y={y + (CELL - MARK_PX) / 2}
                            px={1}
                            opacity={s ? 0.45 : 1}
                            className={isLast && !reducedMotion ? 'velha-pop' : undefined}
                          />
                        )}
                        <rect
                          x={x}
                          y={y}
                          width={CELL}
                          height={CELL}
                          fill="transparent"
                          className={can ? 'velha-cell can' : 'velha-cell'}
                          onPointerEnter={() => setHover({ board: b, cell: c })}
                          onClick={() => play(b, c)}
                        />
                      </g>
                    )
                  })}
                  {/* tabuleiro fechado: a marca grande por cima, ou apagado se deu velha */}
                  {s === 'empate' && <rect x={bx} y={by} width={SMALL} height={SMALL} fill={COLORS.dim} opacity={0.55} pointerEvents="none" />}
                  {(s === 'x' || s === 'o') && (
                    <g pointerEvents="none">
                      <rect x={bx} y={by} width={SMALL} height={SMALL} fill={COLORS.dim} opacity={0.5} />
                      <MarkArt
                        m={s}
                        x={bx + (SMALL - MARK_PX * 3) / 2}
                        y={by + (SMALL - MARK_PX * 3) / 2}
                        px={3}
                        className={last?.board === b && last.closed === s && !reducedMotion ? 'velha-pop' : undefined}
                      />
                    </g>
                  )}
                  {on && (
                    <rect
                      x={bx - 0.75}
                      y={by - 0.75}
                      width={SMALL + 1.5}
                      height={SMALL + 1.5}
                      fill="none"
                      stroke={myTurn ? COLORS.lamp : COLORS.line}
                      strokeWidth={1}
                      strokeDasharray={view.forced === null ? '2 1' : undefined}
                      pointerEvents="none"
                    />
                  )}
                </g>
              )
            })}
            {/* fantasma da sua marca onde o mouse está */}
            {ghost && mine && (
              <MarkArt m={mine} x={cellX(ghost.board, ghost.cell) + (CELL - MARK_PX) / 2} y={cellY(ghost.board, ghost.cell) + (CELL - MARK_PX) / 2} px={1} opacity={0.4} />
            )}
            {/* linha da vitória no tabuleiro grande */}
            {wl && (
              <line
                x1={center(wl[0]).x}
                y1={center(wl[0]).y}
                x2={center(wl[2]).x}
                y2={center(wl[2]).y}
                stroke={view.small[wl[0]] === 'x' ? '#FFC94A' : '#6FA3C7'}
                strokeWidth={2.5}
                strokeLinecap="round"
                shapeRendering="geometricPrecision"
                pointerEvents="none"
              />
            )}
            {focused && (
              <rect
                x={cellX(cur.board, cur.cell) + 0.5}
                y={cellY(cur.board, cur.cell) + 0.5}
                width={CELL - 1}
                height={CELL - 1}
                fill="none"
                stroke={COLORS.lamp}
                strokeWidth={0.75}
                pointerEvents="none"
              />
            )}
          </svg>
          <div className="sr-only" aria-live="polite">
            {focused
              ? `${boardName(cur.board)}, casa do ${spotName(cur.cell)}: ${curMark ? curMark.toUpperCase() : 'vazia'}${myTurn && !isLegal(cur.board, cur.cell) ? ', não vale' : ''}.`
              : ''}
          </div>
        </>
      )}
    </DuelFrame>
  )
}
