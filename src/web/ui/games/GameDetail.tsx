import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react'
import type { GameId } from '../../../shared/games/protocol'
import { Icon } from '../icons'
import { capitalize, summarize, type GameEntry, type OptionValue, type OptionValues } from './catalog'
import { flipFrom, useChannelSurf, useReducedMotion, type FlipSource } from './motion'
import { OptionControls } from './OptionControls'
import { THUMBS } from './thumbs'
import { TvFrame } from './TvFrame'

const CATEGORY_NAME = { cartas: 'Cartas', tabuleiro: 'Tabuleiro', acao: 'Ação' } as const

interface Props {
  entry: GameEntry
  values: OptionValues
  onChange: (id: GameId, key: string, value: OptionValue) => void
  onBack: () => void
  onZap: (dir: 1 | -1) => void
  onOpen: () => void
  flipRef: MutableRefObject<FlipSource | null>
}

/** Detalhes de um jogo: a TV grande passando os quadros, "como funciona" e as opções. */
export function GameDetail({ entry, values, onChange, onBack, onZap, onOpen, flipRef }: Props) {
  const reduced = useReducedMotion()
  const frames = THUMBS[entry.id]
  const { index, go } = useChannelSurf(frames.length, true, 2600, reduced, entry.id)
  const tv = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLHeadingElement>(null)

  // vindo da vitrine: a TV do cartão cresce até aqui (FLIP só com transform)
  useLayoutEffect(() => {
    const f = flipRef.current
    if (!f || !tv.current) return
    flipRef.current = null
    if (!reduced) flipFrom(tv.current, f.rect)
    title.current?.focus({ preventScroll: true })
  }, [flipRef, reduced])

  // jogo trocado pelas setas: leitor de tela lê o nome novo
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    title.current?.focus({ preventScroll: true })
  }, [entry.id])

  const summary = capitalize(summarize(entry.id, values))
  const opening = entry.openLabel

  return (
    <>
      <div className="games-body">
        <div className="games-detail">
          <div className="games-detail-media">
            <div className="games-detail-tv">
              <TvFrame ref={tv} id={entry.id} src={frames[index]} alt={`Print do ${entry.name}`} icon={entry.icon} channel={entry.channel} size="big" on>
                <button type="button" className="games-zap prev" onClick={() => onZap(-1)} aria-label="Jogo anterior" data-tip="Jogo anterior" data-tip-pos="right">
                  <span className="games-zap-icon" aria-hidden="true">
                    <Icon name="chevron" size={18} />
                  </span>
                </button>
                <button type="button" className="games-zap next" onClick={() => onZap(1)} aria-label="Próximo jogo" data-tip="Próximo jogo" data-tip-pos="left">
                  <span className="games-zap-icon" aria-hidden="true">
                    <Icon name="chevron" size={18} />
                  </span>
                </button>
              </TvFrame>
            </div>
            {frames.length > 1 && (
              <div className="games-dots" role="group" aria-label="Quadros do print">
                {frames.map((_, i) => (
                  <button key={i} type="button" className={`games-dot ${i === index ? 'on' : ''}`} aria-label={`Quadro ${i + 1} de ${frames.length}`} aria-pressed={i === index} onClick={() => go(i)} />
                ))}
              </div>
            )}
            <ol className="games-how" aria-label="Como funciona">
              {entry.how.map((h, i) => (
                <li key={`${entry.id}-${i}`} style={{ '--i': i } as React.CSSProperties}>
                  <span className="games-how-icon" aria-hidden="true">
                    <Icon name={h.icon} size={18} />
                  </span>
                  <span>{h.text}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="games-detail-main" key={entry.id}>
            <p className="games-eyebrow pixel-font">
              canal {String(entry.channel).padStart(2, '0')}, {CATEGORY_NAME[entry.category].toLowerCase()}
            </p>
            <h2 ref={title} tabIndex={-1} className="games-detail-name">
              {entry.name}
            </h2>
            <p className="games-detail-desc">{entry.description}</p>
            <div className="games-tags is-detail">
              <span>{entry.people}</span>
              <span>{entry.time}</span>
              {entry.bots && <span className="bots">com robôs</span>}
            </div>
            <OptionControls entry={entry} values={values} onChange={(k, v) => onChange(entry.id, k, v)} />
          </div>
        </div>
      </div>
      <div className="games-foot">
        <button type="button" className="games-back" onClick={onBack}>
          <Icon name="grid" size={16} />
          Outros jogos
        </button>
        <p className="games-summary" aria-live="polite">
          <span className="muted">Resumo:</span> {summary}
        </p>
        <button type="button" className="primary games-open" onClick={onOpen}>
          {opening}
        </button>
      </div>
    </>
  )
}

