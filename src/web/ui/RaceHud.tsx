import '@fontsource-variable/pixelify-sans'
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { TICK_MS, type RaceScoreLine, type RaceView } from '../../shared/games/race/types'
import type { NetStatus, RaceFrame, RaceFrameEvent, RaceSession } from '../game/race/contract'
import { countdownOf, formatTime, lineText, podiumOf, raceClockMs, standingRows, wrongWay, type StandingRow } from '../game/race/hudLogic'
import { netLabel } from '../game/shooter/hudLogic'
import { useInputDevice } from '../game/useInputDevice'
import type { InputDevice, PadFamily } from '../game/inputDevice'
import { Glyph, Key } from './InputGlyph'
import { Icon } from './icons'
import { VolumeSlider } from './media'

export interface RaceHudProps {
  session: RaceSession
  view?: RaceView
  /** meu playerId (null = espectador) */
  you: string | null
  /** cor e nome por slot */
  colors: Record<number, string>
  names: Record<number, string>
  canManage: boolean
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens?: () => void
  musicOn?: boolean
  musicVolume?: number
  onMusicOn?: (on: boolean) => void
  onMusicVolume?: (v: number) => void
  /** miniatura/destaque: o HUD some */
  hidden?: boolean
}

// ---------------------------------------------------------------- estado lido do quadro (10 vezes por segundo)

interface Snap {
  phase: RaceFrame['state']['phase']
  count: number
  clockMs: number
  laps: number
  rows: StandingRow[]
  me: { slot: number; place: number; lap: number; finished: boolean; lapMs: number; bestMs: number; wrong: boolean; boost: boolean } | null
  net: NetStatus
  pingMs: number
  /** segundos que faltam depois que o primeiro chegou */
  graceLeft: number
}

function snapOf(f: RaceFrame | null): Snap | null {
  if (!f) return null
  const s = f.state
  const rows = standingRows(s)
  const meCar = f.me !== null ? s.cars.find((c) => c.slot === f.me) : undefined
  const meRow = meCar ? rows.find((r) => r.slot === meCar.slot) : undefined
  const graceLeft = s.firstFinish > 0 && s.phase === 'correndo' ? Math.max(0, Math.ceil((s.firstFinish + 25 * 60 - s.tick) / 60)) : 0
  return {
    phase: s.phase,
    count: countdownOf(s),
    clockMs: raceClockMs(s),
    laps: s.laps,
    rows,
    me:
      meCar && meRow
        ? {
            slot: meCar.slot,
            place: meRow.place,
            lap: meRow.lap,
            finished: meRow.finished,
            lapMs: meCar.lap > 0 && !meRow.finished ? Math.max(0, (s.tick - meCar.lapStart) * TICK_MS) : 0,
            bestMs: meCar.bestLap * TICK_MS,
            wrong: wrongWay(s, meCar.slot),
            boost: meCar.boostUntil > s.tick
          }
        : null,
    net: f.net,
    pingMs: f.pingMs,
    graceLeft
  }
}

const sigOf = (s: Snap | null): string =>
  s
    ? [
        s.phase,
        s.count,
        Math.floor(s.clockMs / 100),
        s.rows.map((r) => `${r.slot}:${r.lap}:${r.finished}`).join(','),
        s.me ? `${s.me.place}|${s.me.lap}|${s.me.finished}|${Math.floor(s.me.lapMs / 100)}|${s.me.bestMs}|${s.me.wrong}|${s.me.boost}` : '-',
        s.net,
        Math.round(s.pingMs / 5),
        s.graceLeft
      ].join('#')
    : ''

function useSnap(session: RaceSession): Snap | null {
  const [snap, setSnap] = useState<Snap | null>(() => snapOf(session.frame()))
  const last = useRef('')
  useEffect(() => {
    const read = () => {
      const s = snapOf(session.frame())
      const sig = sigOf(s)
      if (sig !== last.current) {
        last.current = sig
        setSnap(s)
      }
    }
    read()
    const t = window.setInterval(read, 100)
    return () => window.clearInterval(t)
  }, [session])
  return snap
}

interface Toast {
  id: number
  text: string
  sub?: string
  tone?: 'best' | 'last' | 'go'
}

// ---------------------------------------------------------------- ajuda

interface HelpSection {
  device: InputDevice
  title: string
  lines: ReactNode[]
}

function helpSections(family: PadFamily): HelpSection[] {
  const g = (b: Parameters<typeof Glyph>[0]['b']) => <Glyph b={b} family={family} />
  return [
    {
      device: 'teclado',
      title: 'Teclado',
      lines: [
        <><Key k="W" /> ou a seta para cima acelera.</>,
        <><Key k="A" /> e <Key k="D" /> (ou as setas) viram.</>,
        <><Key k="S" />, a seta para baixo ou <Key k="Espaço" /> freiam. Parado, dá ré.</>
      ]
    },
    {
      device: 'controle',
      title: 'Controle',
      lines: [
        <>{g('LS')} vira.</>,
        <>{g('RT')} ou {g('A')} aceleram.</>,
        <>{g('LT')} ou {g('B')} freiam. Parado, dá ré.</>
      ]
    },
    {
      device: 'toque',
      title: 'Celular',
      lines: ['As setas da esquerda viram.', 'Acelerar e Frear ficam na direita.']
    }
  ]
}

const ordinal = (n: number) => `${n}º`

export function RaceHud(p: RaceHudProps): ReactElement | null {
  const { session, view, you, colors, names } = p
  const snap = useSnap(session)
  const { device, family } = useInputDevice()
  const [help, setHelp] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const seq = useRef(0)
  const meRef = useRef<number | null>(null)
  meRef.current = snap?.me?.slot ?? null
  const lapsRef = useRef(snap?.laps ?? 0)
  lapsRef.current = snap?.laps ?? 0

  // avisos: largada, volta nova, última volta, chegada
  useEffect(() => {
    return session.onEvents((evs: RaceFrameEvent[]) => {
      for (const e of evs) {
        if (e.type === 'go') setToast({ id: ++seq.current, text: 'Já!', tone: 'go' })
        if (e.type === 'volta' && e.slot === meRef.current) {
          const last = e.lap === lapsRef.current
          setToast({ id: ++seq.current, text: last ? 'Última volta!' : `Volta ${e.lap}`, sub: `${formatTime(e.ticks * TICK_MS)}${e.best ? ', sua melhor' : ''}`, tone: last ? 'last' : e.best ? 'best' : undefined })
        }
        if (e.type === 'chegada' && e.slot === meRef.current) setToast({ id: ++seq.current, text: `Você chegou em ${ordinal(e.place)}`, sub: formatTime(e.ticks * TICK_MS), tone: 'best' })
      }
    })
  }, [session])
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast((c) => (c && c.id === toast.id ? null : c)), toast.tone === 'go' ? 900 : 2400)
    return () => window.clearTimeout(t)
  }, [toast])

  if (p.hidden) return null
  if (!snap) {
    return (
      <div className="tiro-hud" aria-live="polite">
        <div className="tiro-wait pixel-font">Conectando à corrida…</div>
      </div>
    )
  }

  const over = snap.phase === 'fim' || view?.phase === 'fim'
  const me = snap.me
  const ranking: RaceScoreLine[] = view?.ranking ?? []
  const slotOf = (id: string) => view?.players.find((x) => x.id === id)?.slot ?? -1
  const nameOf = (id: string) => view?.players.find((x) => x.id === id)?.name ?? 'Piloto'
  const { top, rest } = podiumOf(ranking)
  const youWon = over && ranking[0]?.id === you && !!you

  return (
    <div className="tiro-hud corrida-hud">
      <div className="sr-only" aria-live="polite">
        {snap.count ? `Largada em ${snap.count}` : ''}
        {toast ? `${toast.text}. ${toast.sub ?? ''}` : ''}
      </div>

      {/* topo: volta e relógio */}
      <div className="tiro-top pixel-font">
        <div className="tiro-clock">
          <strong>{formatTime(snap.clockMs)}</strong>
          <small>
            {me?.finished
              ? `Você chegou em ${ordinal(me.place)}`
              : me
                ? `Volta ${me.lap} de ${snap.laps}`
                : `${snap.laps} voltas`}
            {snap.graceLeft > 0 && !me?.finished ? `. Acaba em ${snap.graceLeft} s` : ''}
          </small>
        </div>
      </div>

      {/* posição e classificação */}
      <div className="corrida-side pixel-font">
        {me && (
          <div className="corrida-pos" aria-label={`Você está em ${ordinal(me.place)} de ${snap.rows.length}`}>
            <strong>{ordinal(me.place)}</strong>
            <small>de {snap.rows.length}</small>
          </div>
        )}
        <ol className="corrida-rows" aria-label="Classificação">
          {snap.rows.map((r) => (
            <li key={r.slot} className={me && r.slot === me.slot ? 'me' : ''}>
              <span className="n">{r.place}</span>
              <i className="golf-dot" style={{ background: colors[r.slot] }} aria-hidden="true" />
              <span className="who">{me && r.slot === me.slot ? 'Você' : names[r.slot] ?? 'Piloto'}</span>
              {r.finished && <Icon name="flag" size={12} />}
            </li>
          ))}
        </ol>
      </div>

      {/* contagem e avisos no meio */}
      {snap.count > 0 && (
        <div className="corrida-count pixel-font" key={`n${snap.count}`} aria-hidden="true">
          {snap.count}
        </div>
      )}
      {toast && !over && (
        <div className={`corrida-toast pixel-font ${toast.tone ?? ''}`} key={`t${toast.id}`}>
          <strong>{toast.text}</strong>
          {toast.sub && <small>{toast.sub}</small>}
        </div>
      )}
      {me?.wrong && !over && (
        <div className="corrida-wrong pixel-font" role="status">
          Contramão! Dê a volta
        </div>
      )}

      {/* tempo da volta */}
      {me && !over && (
        <div className="tiro-me pixel-font corrida-me">
          <div className="corrida-lap">
            <small>Volta</small>
            <span className="num">{formatTime(me.lapMs)}</span>
          </div>
          <div className="corrida-lap">
            <small>Melhor</small>
            <span className="num">{me.bestMs > 0 ? formatTime(me.bestMs) : '-'}</span>
          </div>
          {me.boost && <div className="corrida-boost">Turbo!</div>}
          {device === 'controle' && (
            <div className="tiro-hints">
              <span><Glyph b="RT" /> Acelera</span>
              <span><Glyph b="LT" /> Freia</span>
            </div>
          )}
        </div>
      )}

      {/* ferramentas: rede, música, ajuda, voltar às telas */}
      <div className="tiro-tools">
        <span className={`tiro-net ${snap.net}`} role="status">
          {netLabel(snap.net, snap.pingMs)}
        </span>
        {p.onMusicOn && (
          <button className={`icon-btn ${p.musicOn ? 'on' : ''}`} onClick={() => p.onMusicOn?.(!p.musicOn)} data-tip={p.musicOn ? 'Desligar a música' : 'Ligar a música'} aria-label="Música" aria-pressed={!!p.musicOn}>
            <Icon name="music" size={20} />
          </button>
        )}
        {p.musicOn && p.onMusicVolume && <VolumeSlider value={p.musicVolume ?? 0.35} onChange={p.onMusicVolume} label="Volume da música" />}
        <button className={`icon-btn ${help ? 'on' : ''}`} onClick={() => setHelp((h) => !h)} data-tip="Como jogar" aria-label="Como jogar" aria-expanded={help}>
          <Icon name="help" size={20} />
        </button>
        {p.onBackToScreens && (
          <button className="icon-btn" onClick={p.onBackToScreens} data-tip="Voltar às telas" aria-label="Voltar às telas">
            <Icon name="grid" size={20} />
          </button>
        )}
      </div>

      {help && (
        <div className="tiro-help" role="dialog" aria-label="Como jogar">
          <div className="hands-head">
            <strong>Como jogar</strong>
            <button className="icon-btn sm" onClick={() => setHelp(false)} aria-label="Fechar ajuda">
              <Icon name="x" size={16} />
            </button>
          </div>
          {[...helpSections(family)]
            .sort((a, b) => Number(b.device === device) - Number(a.device === device))
            .map((h) => (
              <section key={h.title} className={h.device === device ? 'now' : ''}>
                <h3>
                  {h.title}
                  {h.device === device && <em> (agora)</em>}
                </h3>
                <ul>
                  {h.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </section>
            ))}
          <p className="small muted">As setas amarelas no chão dão turbo. Fora da pista o carro fica lento.</p>
        </div>
      )}

      {/* fim da corrida */}
      {over && (
        <div className="modal-backdrop">
          <div className="modal ranking tiro-ranking pixel-font" role="dialog" aria-modal="true" aria-label="Fim da corrida">
            <h2>{youWon ? 'Você ganhou!' : 'Fim da corrida'}</h2>
            {ranking.length === 0 ? (
              <p className="muted">Fechando o resultado…</p>
            ) : (
              <ol className="tiro-podium" aria-label="Pódio">
                {[1, 0, 2].map((i) => {
                  const r = top[i]
                  if (!r) return <li key={i} className="empty" aria-hidden="true" />
                  return (
                    <li key={r.id} className={`place-${i + 1} ${r.id === you ? 'me' : ''}`}>
                      <i className="golf-dot" style={{ background: colors[slotOf(r.id)] }} aria-hidden="true" />
                      <span className="n">{nameOf(r.id)}</span>
                      <span className="k">{lineText(r)}</span>
                      <span className="step">{i + 1}º</span>
                    </li>
                  )
                })}
              </ol>
            )}
            {rest.length > 0 && (
              <ol className="rank-list" start={4}>
                {rest.map((r, i) => (
                  <li key={r.id} className={r.id === you ? 'me' : ''}>
                    <span className="rank-place">{i + 4}º</span>
                    <span className="rank-name">{nameOf(r.id)}</span>
                    <span className="rank-net">{lineText(r)}</span>
                  </li>
                ))}
              </ol>
            )}
            {(() => {
              const best = ranking.filter((l) => l.bestLapMs > 0).sort((a, b) => a.bestLapMs - b.bestLapMs)[0]
              return best ? (
                <p className="small muted">
                  Volta mais rápida: {nameOf(best.id)}, {formatTime(best.bestLapMs)}
                </p>
              ) : null
            })()}
            <div className="modal-actions">
              {p.onBackToScreens && <button onClick={p.onBackToScreens}>Voltar às telas</button>}
              {p.canManage && (
                <button className="danger" onClick={p.onClose}>
                  Fechar
                </button>
              )}
              {p.canManage && (
                <button className="primary" onClick={p.onPlayAgain}>
                  Correr de novo
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
