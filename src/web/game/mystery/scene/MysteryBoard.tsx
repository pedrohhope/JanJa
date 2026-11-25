import { useMemo, type ReactElement } from 'react'
import { DOORS, H, MAP, parseCell, RECTS, START, W } from '../../../../shared/games/mystery/board'
import { cardName } from '../../../../shared/games/mystery/cards'
import type { MysteryView } from '../../../../shared/games/mystery/types'
import { dieFace, PAWN, PLAYER_COLORS } from '../../tycoon/scene/pixel'
import { ICONS, runs, type Sprite } from './pixel'

export const pawnColor = (index: number): string => PLAYER_COLORS[index % PLAYER_COLORS.length]

export function Pixels({ sprite, size, color, className }: { sprite: Sprite; size: number | string; color?: string; className?: string }) {
  const w = sprite[0].length
  const h = sprite.length
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
      {runs(sprite, color).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  )
}

/** os dois dados (a chave `rolls` refaz a animação a cada rolada) */
export function MysteryDice({ view, reducedMotion }: { view: MysteryView; reducedMotion: boolean }) {
  return (
    <span className="my-dice" key={view.rolls} aria-label={view.dice ? `Dados: ${view.dice[0]} e ${view.dice[1]}` : 'Dados'}>
      {(view.dice ?? [5, 6]).map((n, k) => (
        <Pixels key={k} sprite={dieFace(n)} size={40} className={`my-die ${view.dice && !reducedMotion ? 'roll' : ''} ${view.dice ? '' : 'idle'}`} />
      ))}
    </span>
  )
}

const pct = (n: number, of: number) => `${(n / of) * 100}%`

/**
 * Planta do Casarão: corredor em casas, cômodos com porta, peões e, na fase de andar, as casas e
 * os cômodos ao alcance dos dados (clicáveis para quem joga).
 */
export function MysteryBoard({ view, onMove }: { view: MysteryView; onMove: (to: string) => void }) {
  const me = view.you?.index ?? null
  const mine = me !== null && view.turn === me && view.phase === 'andar'
  const reach = useMemo(() => new Set(view.reach), [view.reach])
  const turnName = view.turn !== null ? view.players[view.turn]?.name : ''

  // peões: no corredor ficam na casa (lado a lado se dividirem); no cômodo, em fila embaixo
  const byPos = new Map<string, number[]>()
  for (const p of view.players) byPos.set(p.pos, [...(byPos.get(p.pos) ?? []), p.index])

  const cells: ReactElement[] = []
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ch = MAP[y][x]
      if (ch !== '.' && ch !== '#') continue
      const key = `${x},${y}`
      const lit = ch === '.' && reach.has(key)
      const style = { left: pct(x, W), top: pct(y, H), width: pct(1, W), height: pct(1, H) }
      if (lit && mine)
        cells.push(<button key={key} className="my-cell lit" style={style} onClick={() => onMove(key)} aria-label={`Andar para a casa ${x + 1}, ${y + 1}`} />)
      else cells.push(<span key={key} className={`my-cell ${ch === '#' ? 'wall' : (x + y) % 2 ? 'odd' : ''} ${lit ? 'lit' : ''}`} style={style} />)
    }

  return (
    <div className="my-board" style={{ aspectRatio: `${W} / ${H}` }} role="group" aria-label={view.phase === 'andar' ? `Tabuleiro: ${turnName} está andando` : 'Tabuleiro do Casarão'}>
      {cells}
      {RECTS.map((r) => {
        const lit = reach.has(r.room)
        const style = { left: pct(r.x, W), top: pct(r.y, H), width: pct(r.w, W), height: pct(r.h, H) }
        const label = r.room === START ? 'Saguão' : cardName(r.room)
        const body = (
          <>
            <Pixels sprite={ICONS[r.room]} size="34%" className="my-room-icon" />
            <span className="my-room-name">{label}</span>
          </>
        )
        const cls = `my-room ${r.room === START ? 'hall' : ''} ${lit ? 'lit' : ''}`
        return lit && mine ? (
          <button key={r.room} className={cls} style={style} onClick={() => onMove(r.room)} aria-label={`Entrar ${label === 'Saguão' ? 'no Saguão' : `em ${label}`}`}>
            {body}
          </button>
        ) : (
          <div key={r.room} className={cls} style={style}>
            {body}
          </div>
        )
      })}
      {DOORS.map((d) => {
        // traço na borda da porta, do lado do corredor
        const horiz = d.cy !== d.y
        const style = {
          left: pct(horiz ? d.x + 0.2 : Math.max(d.x, d.cx), W),
          top: pct(horiz ? Math.max(d.y, d.cy) : d.y + 0.2, H),
          width: horiz ? pct(0.6, W) : '3px',
          height: horiz ? '3px' : pct(0.6, H),
          transform: horiz ? 'translateY(-50%)' : 'translateX(-50%)'
        }
        return <span key={`${d.x},${d.y},${d.cx},${d.cy}`} className="my-door" style={style} />
      })}
      {view.players.map((p) => {
        const here = byPos.get(p.pos) ?? [p.index]
        const k = here.indexOf(p.index)
        const cell = parseCell(p.pos)
        let left: number
        let top: number
        let size: number
        if (cell) {
          // até 6 numa casa: 1 no meio, senão uma grade de 2 ou 3
          const cols = here.length === 1 ? 1 : here.length <= 4 ? 2 : 3
          size = 1 / cols
          left = cell.x + (k % cols) * size
          top = cell.y + Math.floor(k / cols) * size + (here.length === 1 ? 0 : 0.1)
        } else {
          const r = RECTS.find((q) => q.room === p.pos) ?? RECTS[0]
          size = Math.min(0.9, (r.w - 0.2) / Math.max(here.length, 1))
          left = r.x + (r.w - size * here.length) / 2 + k * size
          top = r.y + r.h - size - 0.1
        }
        return (
          <span
            key={p.playerId}
            className={`my-pawn ${view.turn === p.index ? 'turn' : ''} ${p.out ? 'out' : ''}`}
            style={{ left: pct(left, W), top: pct(top, H), width: pct(size, W), height: pct(size, H) }}
            data-tip={p.name}
            aria-label={`${p.index === me ? 'Você' : p.name}: ${p.pos === START ? 'Saguão' : cell ? 'corredor' : cardName(p.pos)}`}
          >
            <Pixels sprite={PAWN} size="100%" color={pawnColor(p.index)} />
          </span>
        )
      })}
    </div>
  )
}
