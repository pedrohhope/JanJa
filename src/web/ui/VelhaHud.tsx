import { boardName } from '../../shared/games/velha/rules'
import { describeResult, type VelhaAction, type VelhaView } from '../../shared/games/velha/types'
import { DuelHud, MoveList, type DuelHudCommon } from './DuelHud'

interface Props extends DuelHudCommon {
  view: VelhaView
  onAct: (action: VelhaAction) => void
}

const SIDES = { w: 'X', b: 'O' } as const

/** Barra de baixo da Velha ao quadrado (a parte comum com o xadrez e as damas fica no DuelHud). */
export function VelhaHud({ view, ...rest }: Props) {
  const n = view.moves.length
  const last = view.lastMove
  const won = { x: view.small.filter((s) => s === 'x').length, o: view.small.filter((s) => s === 'o').length }
  return (
    <DuelHud
      {...rest}
      view={view}
      sideNames={SIDES}
      title={n === 0 ? 'Começo da partida' : `Lance ${n} · X ${won.x} x ${won.o} O`}
      yourTurn={view.forced !== null ? `Sua vez. Jogue no ${boardName(view.forced)} (o destacado).` : 'Sua vez. Jogue em qualquer tabuleiro aberto.'}
      resultText={view.result ? describeResult(view.result, view.white.name, view.black.name) : null}
      moves={<MoveList moves={view.moves.map((m) => m.text)} />}
      live={
        last
          ? `${last.mark.toUpperCase()} jogou no ${boardName(last.board)}.${last.closed === 'x' || last.closed === 'o' ? ` ${last.closed.toUpperCase()} ganhou esse tabuleiro.` : last.closed === 'empate' ? ' Esse tabuleiro deu velha.' : ''}`
          : ''
      }
    />
  )
}
