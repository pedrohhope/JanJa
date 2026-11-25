import '@fontsource-variable/pixelify-sans'
import { useEffect, useMemo, useState } from 'react'
import { cardById, inPlace, PLACES, SUSPECTS, TOOLS, type Kind, type MysteryCard } from '../../../../shared/games/mystery/cards'
import type { MysteryView, SuggestionView, Triple } from '../../../../shared/games/mystery/types'
import { Icon } from '../../../ui/icons'
import type { MysterySceneProps } from '../../contract'
import { autoMarks, inEnvelope, merge, nextMark, ruledOut, type Mark, type Marks } from './notes'
import { MysteryBoard, MysteryDice, pawnColor } from './MysteryBoard'
import { ICONS, portrait, runs } from './pixel'

const KIND_LABEL: Record<Kind, string> = { quem: 'Quem', onde: 'Onde', como: 'Com o quê' }
const KIND_COLOR: Record<Kind, string> = { quem: '#E07A9A', onde: '#6FA3C7', como: '#FFC94A' }
const GROUPS: Array<[Kind, readonly MysteryCard[]]> = [
  ['quem', SUSPECTS],
  ['onde', PLACES],
  ['como', TOOLS]
]

function Art({ card, size }: { card: MysteryCard; size: number }) {
  const sprite = card.kind === 'quem' ? portrait(card.id) : ICONS[card.id]
  const n = sprite.length
  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" aria-hidden="true" className="my-art">
      {runs(sprite, card.color).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  )
}

/** carta do Mistério: faixa do tipo, desenho e nome */
export function MysteryCardTile({ id, small, dim, on, onClick }: { id: string; small?: boolean; dim?: boolean; on?: boolean; onClick?: () => void }) {
  const c = cardById(id)
  if (!c) return null
  const body = (
    <>
      <span className="my-band" style={{ background: KIND_COLOR[c.kind] }}>
        {KIND_LABEL[c.kind]}
      </span>
      <Art card={c} size={small ? 36 : 56} />
      <span className="my-cname">{c.name}</span>
    </>
  )
  const cls = `my-card ${small ? 'small' : ''} ${dim ? 'dim' : ''} ${on ? 'on' : ''}`
  return onClick ? (
    <button className={cls} onClick={onClick} aria-pressed={on} aria-label={c.name}>
      {body}
    </button>
  ) : (
    <div className={cls} aria-label={c.name}>
      {body}
    </div>
  )
}

const storageKey = (v: MysteryView) => `janja.misterio.${v.players.map((p) => p.playerId).join('-')}.${[...v.myCards].sort().join('-')}`

/** marcas que a pessoa fez à mão (guardadas neste navegador, por partida) */
function useManualMarks(v: MysteryView): [Marks, (card: string, p: number) => void] {
  const key = storageKey(v)
  const [marks, setMarks] = useState<Marks>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}') as Marks
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(marks))
    } catch {
      // sem armazenamento: o caderno vale só nesta aba
    }
  }, [key, marks])
  const cycle = (card: string, p: number) =>
    setMarks((m) => ({ ...m, [card]: { ...(m[card] ?? {}), [p]: nextMark((m[card]?.[p] ?? '') as Mark) } }))
  return [marks, cycle]
}

function MarkGlyph({ m }: { m: Mark | undefined }) {
  if (m === 'tem') return <Icon name="check" size={14} />
  if (m === 'nao') return <Icon name="x" size={14} />
  if (m === 'talvez') return <span>?</span>
  return null
}

function Notebook({ view, marks, auto, onCycle }: { view: MysteryView; marks: Marks; auto: Marks; onCycle: (card: string, p: number) => void }) {
  const n = view.players.length
  return (
    <table className="my-notes">
      <thead>
        <tr>
          <th scope="col">Caderno</th>
          {view.players.map((p) => (
            <th key={p.playerId} scope="col" data-tip={p.name} aria-label={p.name}>
              {p.index === view.you?.index ? 'Você' : p.name.slice(0, 4)}
            </th>
          ))}
        </tr>
      </thead>
      {GROUPS.map(([kind, cards]) => (
        <tbody key={kind}>
          <tr className="my-notes-head">
            <th colSpan={n + 1} scope="colgroup">
              {KIND_LABEL[kind]}
            </th>
          </tr>
          {cards.map((c) => {
            const out = ruledOut(marks, c.id)
            const env = inEnvelope(marks, c.id, n)
            return (
              <tr key={c.id} className={`${out ? 'out' : ''} ${env ? 'env' : ''}`}>
                <th scope="row">{c.name}</th>
                {view.players.map((p) => {
                  const locked = auto[c.id]?.[p.index] !== undefined
                  const m = marks[c.id]?.[p.index]
                  return (
                    <td key={p.playerId}>
                      <button
                        className={`my-mark ${m ?? ''} ${locked ? 'auto' : ''}`}
                        disabled={locked}
                        onClick={() => onCycle(c.id, p.index)}
                        aria-label={`${c.name}, ${p.name}: ${m === 'tem' ? 'tem' : m === 'nao' ? 'não tem' : m === 'talvez' ? 'talvez' : 'sem marca'}`}
                      >
                        <MarkGlyph m={m} />
                      </button>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      ))}
    </table>
  )
}

function suggestionLine(h: SuggestionView, v: MysteryView): string {
  const name = (i: number) => (i === v.you?.index ? 'você' : v.players[i]?.name ?? 'alguém')
  if (h.shownBy === null) return 'Ninguém tinha nenhuma.'
  const shown = h.card ? `: ${cardById(h.card)?.name}` : ''
  return `${name(h.shownBy)} mostrou para ${name(h.by)}${shown}.`
}

/** escolha de quem, onde e com o quê; `room` fixa o onde (palpite só no cômodo em que está) */
function Picker({ pick, setPick, marks, room }: { pick: Partial<Triple>; setPick: (f: (p: Partial<Triple>) => Partial<Triple>) => void; marks: Marks; room?: string }) {
  return (
    <>
      {GROUPS.map(([kind, cards]) => (
        <div key={kind} className="my-pick-row" role="group" aria-label={KIND_LABEL[kind]}>
          <span className="my-pick-label">{KIND_LABEL[kind]}</span>
          <div className="my-row wrap">
            {kind === 'onde' && room ? (
              <MysteryCardTile id={room} small on />
            ) : (
              cards.map((c) => (
                <MysteryCardTile
                  key={c.id}
                  id={c.id}
                  small
                  on={pick[kind] === c.id}
                  dim={ruledOut(marks, c.id)}
                  onClick={() => setPick((p) => ({ ...p, [kind]: c.id }))}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </>
  )
}

/** Mistério: as suas cartas e o caderno; o tabuleiro com dados; palpite, acusação e mostrar carta. */
export function MysteryScene({ view, onAct, reducedMotion }: MysterySceneProps) {
  const me = view.you?.index ?? null
  const myTurn = me !== null && view.turn === me
  const auto = useMemo(() => autoMarks(view), [view])
  const [manual, cycle] = useManualMarks(view)
  const marks = useMemo(() => merge(auto, manual), [auto, manual])
  const [pick, setPick] = useState<Partial<Triple>>({})
  const [accusing, setAccusing] = useState(false)
  const [sure, setSure] = useState(false)

  useEffect(() => {
    setSure(false)
    setAccusing(false)
    if (!myTurn) setPick({})
  }, [myTurn, view.phase])

  const name = (i: number) => (i === me ? 'Você' : view.players[i]?.name ?? 'Alguém')
  const cur = view.current
  const room = me !== null ? view.players[me].pos : ''
  const canAccuse = myTurn && (view.phase === 'rolar' || view.phase === 'palpite' || view.phase === 'depois')
  const guess: Partial<Triple> = view.phase === 'palpite' && !accusing ? { ...pick, onde: room } : pick
  const full = !!(guess.quem && guess.onde && guess.como)
  const sum = view.dice ? view.dice[0] + view.dice[1] : 0

  let status: string
  if (view.phase === 'fim') status = 'Partida encerrada.'
  else if (!myTurn) status = view.turn !== null ? `Vez de ${name(view.turn)}.` : ''
  else if (view.phase === 'rolar') status = 'Sua vez: role os dados para andar pelo Casarão.'
  else if (view.phase === 'andar') status = `Você tirou ${sum}: clique numa casa acesa ou num cômodo.`
  else if (view.phase === 'palpite') status = `Você entrou ${inPlace(room)}: palpite quem foi e com o quê.`
  else if (view.phase === 'depois') status = 'Acuse se tiver certeza, ou termine a vez.'
  else status = ''

  return (
    <div className="my-scene">
      <section className="my-left">
        <h3 className="pixel-font">Suas cartas</h3>
        <div className="my-hand">
          {view.myCards.length ? view.myCards.map((id) => <MysteryCardTile key={id} id={id} small />) : <p className="small muted">Você está assistindo.</p>}
        </div>
        {me !== null && <Notebook view={view} marks={marks} auto={auto} onCycle={cycle} />}
      </section>

      <section className="my-right">
        <ul className="my-players">
          {view.players.map((p) => (
            <li key={p.playerId} className={`${view.turn === p.index ? 'turn' : ''} ${view.refuter === p.index ? 'showing' : ''} ${p.out ? 'out' : ''}`}>
              <span>
                <i className="my-swatch" style={{ background: pawnColor(p.index) }} aria-hidden="true" />
                {name(p.index)}
              </span>
              <small>
                {p.out ? 'errou a acusação' : `${p.cards} cartas`}
                {p.away ? ' · fora' : ''}
              </small>
            </li>
          ))}
        </ul>

        <MysteryBoard view={view} onMove={(to) => onAct({ type: 'move', to })} />

        <div className="my-turnbox">
          <MysteryDice view={view} reducedMotion={reducedMotion} />
          <span className="my-status">{status}</span>
          {myTurn && !accusing && (
            <div className="my-actions">
              {view.phase === 'rolar' && (
                <button className="primary" onClick={() => onAct({ type: 'roll' })}>
                  Rolar os dados
                </button>
              )}
              {view.phase === 'andar' && <button onClick={() => onAct({ type: 'end' })}>Ficar parado</button>}
              {view.phase === 'depois' && <button onClick={() => onAct({ type: 'end' })}>Terminar a vez</button>}
              {canAccuse && <button onClick={() => setAccusing(true)}>Acusar</button>}
            </div>
          )}
        </div>

        {cur && (
          <div className="my-current">
            <strong className="pixel-font">{name(cur.by)} palpitou</strong>
            <div className="my-row">
              {[cur.quem, cur.onde, cur.como].map((id) => (
                <MysteryCardTile key={id} id={id} on={cur.card === id} />
              ))}
            </div>
            <p className="small">
              {view.phase === 'mostrar' && view.refuter !== null
                ? view.refuter === me
                  ? 'Você tem mais de uma: escolha qual mostrar.'
                  : `Esperando ${name(view.refuter)} mostrar uma carta.`
                : suggestionLine(cur, view)}
            </p>
            {view.myChoices.length > 0 && (
              <div className="my-row">
                {view.myChoices.map((id) => (
                  <MysteryCardTile key={id} id={id} onClick={() => onAct({ type: 'show', card: id })} />
                ))}
              </div>
            )}
          </div>
        )}

        {myTurn && view.phase === 'palpite' && !accusing && (
          <div className="my-pick">
            <strong className="pixel-font">Palpite {inPlace(room)}</strong>
            <Picker pick={pick} setPick={setPick} marks={marks} room={room} />
            <div className="my-actions">
              <button className="primary" disabled={!full} onClick={() => onAct({ type: 'suggest', ...(guess as Triple) })}>
                Palpitar
              </button>
              <button onClick={() => onAct({ type: 'end' })}>Não palpitar</button>
            </div>
          </div>
        )}

        {canAccuse && accusing && (
          <div className="my-pick accuse">
            <strong className="pixel-font">Acusação: quem, onde e com o quê</strong>
            <Picker pick={pick} setPick={setPick} marks={marks} />
            <div className="my-actions">
              <button
                className={sure ? 'danger' : 'primary'}
                disabled={!full}
                onClick={() => {
                  if (!sure) return setSure(true)
                  setSure(false)
                  onAct({ type: 'accuse', ...(pick as Triple) })
                }}
              >
                {sure ? 'Confirmar: se errar, sai do jogo' : 'Acusar'}
              </button>
              <button
                onClick={() => {
                  setAccusing(false)
                  setSure(false)
                }}
              >
                Voltar
              </button>
            </div>
          </div>
        )}

        {view.history.length > 0 && (
          <ol className="my-history" aria-label="Palpites">
            {[...view.history].reverse().slice(0, 8).map((h, k) => (
              <li key={view.history.length - k}>
                <b>{name(h.by)}</b>: {[h.quem, h.onde, h.como].map((id) => cardById(id)?.name).join(', ')}
                <small> · {suggestionLine(h, view)}</small>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
