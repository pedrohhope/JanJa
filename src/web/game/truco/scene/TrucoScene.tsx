import '@fontsource-variable/pixelify-sans'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { cardName, power } from '../../../../shared/games/truco/cards'
import { envidoName, trucoName, type MesaView, type TrucoCall, type TrucoEvent } from '../../../../shared/games/truco/types'
import type { TrucoSceneProps } from '../../contract'
import { playSpot, seatSpot } from './layout'
import { getPrefs, setPrefs } from '../../../storage'
import { CardBack, CardFace } from './CardFace'
import { TrucoGuide } from './TrucoGuide'

/** cor de cada time (o seu é sempre o abajur) */
const TEAM_COLOR = ['#FFC94A', '#6FA3C7']
const BUBBLE_MS = 2600

const CALL_TEXT: Record<TrucoCall, string> = {
  truco: 'Truco!',
  retruco: 'Retruco!',
  vale4: 'Vale quatro!',
  envido: 'Envido!',
  real: 'Real envido!',
  falta: 'Falta envido!',
  flor: 'Flor!',
  contraflor: 'Contra-flor!'
}

/** Balões com o que cada um cantou (truco, envido, quero...) no último lote de eventos. */
function useBubbles(lastEvents: TrucoSceneProps['lastEvents']): Record<number, string> {
  const [bubbles, setBubbles] = useState<Record<number, { text: string; at: number }>>({})
  const seen = useRef(lastEvents?.seq ?? -1)
  useEffect(() => {
    if (!lastEvents || lastEvents.seq === seen.current) return
    seen.current = lastEvents.seq
    const add: Record<number, { text: string; at: number }> = {}
    for (const ev of lastEvents.events as TrucoEvent[]) {
      if (ev.type === 'call') add[ev.p] = { text: CALL_TEXT[ev.call], at: Date.now() }
      if (ev.type === 'answer') add[ev.p] = { text: ev.quero ? 'Quero!' : 'Não quero.', at: Date.now() }
      if (ev.type === 'mazo') add[ev.p] = { text: 'Vou ao baralho.', at: Date.now() }
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

/** carta que ganhou a vaza (para destacar) */
function winningCards(m: MesaView): Set<string> {
  const out = new Set<string>()
  for (const t of m.tricks) {
    if (t.result === null || t.result === 'P') continue
    const best = Math.max(...t.plays.map((x) => power(x.card)))
    const top = t.plays.find((x) => power(x.card) === best)
    if (top) out.add(top.card)
  }
  return out
}

function mesaStatus(m: MesaView): string {
  const parts: string[] = []
  parts.push(m.truco.level === 1 ? 'Vale 1' : `${trucoName(m.truco.level)} (vale ${m.truco.level})`)
  if (m.truco.pending) parts.push(`pediram ${trucoName(m.truco.pending).toLowerCase()}`)
  if (m.envido.calls.length && !m.envido.result) parts.push(m.envido.calls.map(envidoName).join(' + '))
  return parts.join(' · ')
}

/** Mesa do truco: placas em volta, cartas jogadas na frente de cada um, a sua mão embaixo. */
export function TrucoScene({ view, lastEvents, reducedMotion, onPlay }: TrucoSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 800, h: 600 })
  const bubbles = useBubbles(lastEvents)
  // em tela estreita o painel cobriria a mesa: começa fechado (a escolha salva vale para telas largas)
  const [guide, setGuide] = useState(() => getPrefs().trucoGuide && window.innerWidth >= 1000)
  const toggleGuide = (on: boolean) => {
    setGuide(on)
    setPrefs({ trucoGuide: on })
  }

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const fit = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])

  const n = view.players.length
  const me = view.you?.index ?? 0
  const cw = Math.round(Math.max(40, Math.min(96, Math.min(box.w, box.h) * 0.085)))
  const small = Math.round(cw * 0.78)
  const myTeam = view.you?.team ?? 0
  const teamColor = (t: number) => (t === myTeam ? TEAM_COLOR[0] : TEAM_COLOR[1])
  const canPlay = !!view.can?.play
  const mesaOfP = (p: number) => view.mesas.find((m) => m.order.includes(p))
  const winners = new Set(view.mesas.flatMap((m) => [...winningCards(m)]))
  const myMesa = view.mesas.find((m) => m.id === view.myMesa) ?? view.mesas[0]

  return (
    <div className="tr-wrap">
      <div className="tr-scene" ref={hostRef} style={{ '--cw': `${cw}px` } as CSSProperties}>
        <div className="tr-felt" aria-hidden="true" />
        {!guide && (
          <button className="tr-guide-open" onClick={() => toggleGuide(true)} data-tip="Ordem das cartas e regras">
            Regras
          </button>
        )}

        {view.players.map((pl) => {
          const k = (pl.index - me + n) % n
          // a sua placa vai para o canto, para não ficar embaixo da sua mão
          const seat = k === 0 ? { x: 0.14, y: 0.9 } : seatSpot(k, n)
          const spot = playSpot(k, n)
          const m = mesaOfP(pl.index)
          const acting = !!m && view.phase === 'jogando' && (m.turn === pl.index || (m.answering !== null && m.answering === pl.team && m.asking !== null))
          const played = m ? m.tricks.flatMap((t) => t.plays.filter((x) => x.p === pl.index).map((x) => x.card)) : []
          const rival = view.testa && m ? view.players[m.order.find((x) => x !== pl.index) ?? pl.index] : null
          const isMe = view.you?.index === pl.index
          return (
            <div key={pl.playerId}>
              <div className={`tr-plate ${acting ? 'acting' : ''} ${isMe ? 'me' : ''}`} style={{ left: `${seat.x * 100}%`, top: `${seat.y * 100}%`, '--team': teamColor(pl.team) } as CSSProperties}>
                <span className="tr-name">
                  {pl.name}
                  {isMe ? ' (você)' : ''}
                </span>
                <span className="tr-tags">
                  <i className="tr-team">{pl.team === myTeam ? 'Nós' : 'Eles'}</i>
                  {m?.mao === pl.index && <i>mão</i>}
                  {view.dealer === pl.index && <i>deu</i>}
                  {pl.flor && <i className="tr-flor">flor</i>}
                  {pl.away && <i>fora</i>}
                  {rival && <i>contra {rival.name}</i>}
                </span>
                {!isMe && pl.cardsLeft > 0 && (
                  <span className="tr-backs" aria-label={`${pl.cardsLeft} cartas na mão`}>
                    {Array.from({ length: pl.cardsLeft }, (_, j) => (
                      <CardBack key={j} width={Math.round(cw * 0.32)} />
                    ))}
                  </span>
                )}
                {bubbles[pl.index] && (
                  <span className="tr-bubble pixel-font" role="status">
                    {bubbles[pl.index]}
                  </span>
                )}
              </div>
              {played.length > 0 && (
                <div className="tr-played" style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }} aria-label={`${pl.name} jogou ${played.map(cardName).join(', ')}`}>
                  {played.map((c, j) => (
                    <span key={c} className={`tr-played-card ${winners.has(c) ? 'won' : ''} ${reducedMotion ? '' : 'in'}`} style={{ zIndex: j }}>
                      <CardFace card={c} width={small} />
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        <div className="tr-center">
          <strong className="pixel-font">
            {view.score[myTeam]} x {view.score[myTeam === 0 ? 1 : 0]}
          </strong>
          <small>
            Mão {view.hand}
            {view.testa ? ' · testa' : ''} · {myMesa ? mesaStatus(myMesa) : ''}
          </small>
          {myMesa?.envido.result && myMesa.envido.result.sung.length > 0 && (
            <small className="tr-envido">Envido: {myMesa.envido.result.sung.map((x) => `${view.players[x.p].name} ${x.points}`).join(' x ')}</small>
          )}
          <ol className="tr-log" aria-live="polite" aria-label="Histórico">
            {view.log.slice(-3).map((l, k) => (
              <li key={`${view.log.length}-${k}`}>{l}</li>
            ))}
          </ol>
        </div>

        {view.myCards.length > 0 && (
          <div className={`tr-hand ${canPlay ? 'can' : ''}`} aria-label="Suas cartas">
            {view.myCards.map((c, j) => (
              <button
                key={c}
                className="tr-hand-card"
                disabled={!canPlay}
                onClick={() => onPlay(c)}
                aria-label={`Jogar ${cardName(c)}${canPlay ? ` (tecla ${j + 1})` : ''}`}
                data-tip={canPlay ? `Jogar ${cardName(c)} (${j + 1})` : cardName(c)}
              >
                <CardFace card={c} width={cw} />
              </button>
            ))}
          </div>
        )}
      </div>
      {guide && <TrucoGuide mine={view.myCards} onClose={() => toggleGuide(false)} />}
    </div>
  )
}
