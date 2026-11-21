import '@fontsource-variable/pixelify-sans'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { CHARACTERS } from '../../shared/games/brawl/characters'
import {
  CHARACTER_IDS,
  CHARACTER_TAGLINES,
  type BrawlAction,
  type BrawlPlayerView,
  type BrawlScoreLine,
  type BrawlSimPhase,
  type BrawlView,
  type CharacterId,
  type Held
} from '../../shared/games/brawl/types'
import type { BrawlFrame, BrawlFrameEvent, BrawlSession, NetStatus } from '../game/brawl/contract'
import {
  ARENA_NAME,
  TEAM_NAMES,
  WEAPON_LABEL,
  WEIGHT_LABEL,
  cycle,
  damageColor,
  netLabel,
  pickSecondsLeft,
  podiumOf
} from '../game/brawl/hudLogic'
import { portraitUrl, weaponIconUrl } from '../game/brawl/portraits'
import { formatClock } from '../game/helpers'
import { useInputDevice } from '../game/useInputDevice'
import { Avatar } from './Avatar'
import { Glyph, Key, padLabel } from './InputGlyph'
import { Icon } from './icons'
import { VolumeSlider } from './media'

export interface BrawlHudProps {
  session: BrawlSession | null
  view: BrawlView
  /** meu playerId (ou null, espectador) */
  you: string | null
  /** cor do contorno por slot (time ou jogador) */
  colors: Record<number, string>
  canManage: boolean
  /** pick, ready e rematch vão ao coordenador */
  act: (action: BrawlAction) => void
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

// ---------------------------------------------------------------- imagens

function Portrait({ char, tint, anim, frame, held, scale = 3, className = '' }: { char: CharacterId; tint: string; anim?: Parameters<typeof portraitUrl>[2] extends infer O ? (O extends { anim?: infer A } ? A : never) : never; frame?: number; held?: Held; scale?: number; className?: string }): ReactElement {
  const url = useMemo(() => portraitUrl(char, tint, { anim, frame, held, scale }), [char, tint, anim, frame, held, scale])
  return <img className={`briga-portrait ${className}`} src={url} alt="" draggable={false} />
}

function WeaponIcon({ weapon, scale = 2 }: { weapon: keyof typeof WEAPON_LABEL; scale?: number }): ReactElement {
  const url = useMemo(() => weaponIconUrl(weapon, scale), [weapon, scale])
  return <img className="briga-wicon" src={url} alt="" draggable={false} />
}

const HEART_ROWS = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...']
const heartCache = new Map<string, string>()
function heartUrl(color: string): string {
  const hit = heartCache.get(color)
  if (hit) return hit
  const s = 2
  const cv = document.createElement('canvas')
  cv.width = 7 * s
  cv.height = 6 * s
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = color
  HEART_ROWS.forEach((row, y) => [...row].forEach((c, x) => c === '#' && ctx.fillRect(x * s, y * s, s, s)))
  const url = cv.toDataURL()
  heartCache.set(color, url)
  return url
}

// ---------------------------------------------------------------- estado lido do quadro

interface FighterSnap {
  slot: number
  char: CharacterId
  damage: number
  stocks: number
  held: Held
  out: boolean
  eliminated: boolean
}

interface Snap {
  phase: BrawlSimPhase
  timeLeftMs: number
  me: number | null
  fighters: FighterSnap[]
  net: NetStatus
  pingMs: number
}

function snapOf(f: BrawlFrame | null): Snap | null {
  if (!f) return null
  return {
    phase: f.state.phase,
    timeLeftMs: f.timeLeftMs,
    me: f.me,
    fighters: f.state.fighters
      .filter((x) => !x.away)
      .map((x) => ({ slot: x.slot, char: x.char, damage: x.damage, stocks: x.stocks, held: x.held, out: x.action === 'fora', eliminated: x.action === 'eliminado' }))
      .sort((a, b) => a.slot - b.slot),
    net: f.net,
    pingMs: f.pingMs
  }
}

const sigOf = (s: Snap | null): string =>
  s
    ? [
        s.phase,
        Math.ceil(s.timeLeftMs / 1000),
        s.me,
        s.fighters.map((x) => `${x.slot}:${x.char}:${Math.round(x.damage)}:${x.stocks}:${x.held}:${x.out ? 1 : 0}${x.eliminated ? 1 : 0}`).join(','),
        s.net,
        Math.round(s.pingMs / 5)
      ].join('#')
    : ''

function useSnap(session: BrawlSession | null): Snap | null {
  const [snap, setSnap] = useState<Snap | null>(() => snapOf(session?.frame() ?? null))
  const last = useRef('')
  useEffect(() => {
    if (!session) {
      last.current = ''
      setSnap(null)
      return
    }
    const read = () => {
      const s = snapOf(session.frame())
      const sig = sigOf(s)
      if (sig !== last.current) {
        last.current = sig
        setSnap(s)
      }
    }
    read()
    const t = window.setInterval(read, 80)
    return () => window.clearInterval(t)
  }, [session])
  return snap
}

// ---------------------------------------------------------------- escolha de personagem

const PAD_REPEAT_MS = 220

/** teclado e controle da tela de escolha: troca (setas/A/D, analógico, direcional), confirma (Enter, Espaço, J, botão A) */
function usePickControls(enabled: boolean, onMove: (dir: -1 | 1) => void, onConfirm: () => void): void {
  const move = useRef(onMove)
  const confirm = useRef(onConfirm)
  move.current = onMove
  confirm.current = onConfirm
  useEffect(() => {
    if (!enabled) return
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName) || el.isContentEditable)
    }
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault()
        move.current(-1)
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault()
        move.current(1)
      } else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyJ') {
        if (e.repeat) return
        e.preventDefault()
        confirm.current()
      }
    }
    window.addEventListener('keydown', onKey)
    let raf = 0
    let lastMove = 0
    let aHeld = false
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const pads = navigator.getGamepads?.() ?? []
      let dir = 0
      let a = false
      for (const g of pads) {
        if (!g) continue
        const x = g.axes[0] ?? 0
        if (x < -0.5 || g.buttons[14]?.pressed) dir = -1
        else if (x > 0.5 || g.buttons[15]?.pressed) dir = 1
        if (g.buttons[0]?.pressed) a = true
      }
      const now = performance.now()
      if (dir !== 0 && now - lastMove > PAD_REPEAT_MS) {
        lastMove = now
        move.current(dir as -1 | 1)
      } else if (dir === 0) lastMove = 0
      if (a && !aHeld) confirm.current()
      aHeld = a
    }
    raf = requestAnimationFrame(loop)
    return () => {
      window.removeEventListener('keydown', onKey)
      cancelAnimationFrame(raf)
    }
  }, [enabled])
}

function rulesText(view: BrawlView): string {
  const o = view.options
  const rule = o.mode === 'vidas' ? (o.stocks === 1 ? '1 vida' : `${o.stocks} vidas`) : `${o.minutes} minutos`
  const teams = o.teamSize === 0 ? 'Todos contra todos' : `Times ${o.teamSize}x${o.teamSize}${o.friendlyFire ? ', com fogo amigo' : ''}`
  return `${rule}. ${teams}.`
}

function BrawlPick(p: BrawlHudProps): ReactElement {
  const { view, you, colors, act } = p
  const { device, family } = useInputDevice()
  const me = view.players.find((x) => x.id === you) ?? null
  const [sel, setSel] = useState<CharacterId>(me?.char ?? 'jan')
  const [, tick] = useState(0)
  // o servidor manda a escolha de volta: segue o que ele diz
  useEffect(() => {
    if (me) setSel(me.char)
  }, [me?.char]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 250)
    return () => window.clearInterval(t)
  }, [])

  const selRef = useRef(sel)
  selRef.current = sel
  const ready = !!me?.ready
  const pick = useCallback(
    (char: CharacterId) => {
      setSel(char)
      act({ type: 'pick', char })
    },
    [act]
  )
  const toggleReady = useCallback(() => act({ type: 'ready', ready: !ready }), [act, ready])
  usePickControls(
    !!me && !p.hidden,
    (dir) => {
      const i = CHARACTER_IDS.indexOf(selRef.current)
      pick(CHARACTER_IDS[cycle(i, dir, CHARACTER_IDS.length)]!)
    },
    toggleReady
  )

  const secs = pickSecondsLeft(view.pickEndsAt, Date.now())
  const humans = view.players.filter((x) => !x.bot && x.present)
  const waiting = humans.filter((x) => !x.ready).length

  return (
    <div className="briga-pick pixel-font" role="region" aria-label="Escolha do lutador">
      <header className="briga-pick-head">
        <div>
          <h2>{me ? 'Escolha o seu lutador' : 'Escolha de lutadores'}</h2>
          <p className="briga-sub">
            {ARENA_NAME[view.arenaId]}. {rulesText(view)}
          </p>
        </div>
        <div className={`briga-pick-clock ${secs <= 5 ? 'hurry' : ''}`} role="timer" aria-label={`Faltam ${secs} segundos`}>
          <strong>{secs}</strong>
          <small>{waiting > 0 ? `Falta${waiting > 1 ? 'm' : ''} ${waiting} marcar pronto` : 'Todo mundo pronto'}</small>
        </div>
      </header>

      <ul className="briga-cards" role="listbox" aria-label="Lutadores" aria-orientation="horizontal">
        {CHARACTER_IDS.map((id) => {
          const spec = CHARACTERS[id]
          const chosen = view.players.filter((x) => x.present && x.char === id)
          const mine = !!me && sel === id
          return (
            <li key={id}>
              <button
                type="button"
                role="option"
                aria-selected={mine}
                className={`briga-card ${mine ? 'mine' : ''}`}
                disabled={!me}
                onClick={() => pick(id)}
              >
                <span className="briga-card-who" aria-label={chosen.length ? `Escolhido por ${chosen.map((c) => c.name).join(', ')}` : 'Ninguém escolheu'}>
                  {chosen.length === 0 && <small className="muted">Ninguém ainda</small>}
                  {chosen.slice(0, 5).map((c) => (
                    <WhoChip key={c.id} p={c} color={colors[c.slot]} you={c.id === you} />
                  ))}
                  {chosen.length > 5 && <small>+{chosen.length - 5}</small>}
                </span>
                <span className="briga-card-art">
                  <Portrait char={id} tint={mine ? '#FFC94A' : '#F3EBDD'} anim={mine ? 'win' : 'idle'} frame={0} scale={6} />
                </span>
                <strong className="briga-card-name">{spec.name}</strong>
                <span className="briga-card-tag">{CHARACTER_TAGLINES[id]}</span>
                <span className="briga-card-stats">
                  <span>
                    <em>Peso</em> {WEIGHT_LABEL[spec.weightClass]}
                  </span>
                  <span className="briga-likes">
                    <em>Gosta de</em>
                    {spec.likes.map((w) => (
                      <span key={w} className="briga-like">
                        <WeaponIcon weapon={w} />
                        {WEAPON_LABEL[w]}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <footer className="briga-pick-foot">
        <ul className="briga-roster" aria-label="Quem está na luta">
          {view.players.filter((x) => x.present).map((x) => (
            <li key={x.id} className={x.ready ? 'ready' : ''}>
              <i className="golf-dot" style={{ background: colors[x.slot] }} aria-hidden="true" />
              <span className="n">{x.name}</span>
              {view.options.teamSize > 0 && <span className="t">{TEAM_NAMES[x.team % 4]}</span>}
              <span className="s">{x.ready ? 'Pronto' : 'Escolhendo'}</span>
            </li>
          ))}
        </ul>
        <div className="briga-pick-actions">
          {me ? (
            <>
              <button className={ready ? '' : 'primary'} onClick={toggleReady} aria-pressed={ready}>
                {ready ? 'Tirar o pronto' : 'Pronto'}
                {device === 'controle' && <Glyph b="A" family={family} />}
              </button>
              <p className="briga-keys">
                {device === 'controle' ? (
                  <>
                    <Glyph b="DPad" family={family} /> ou <Glyph b="LS" family={family} /> trocam o lutador, <Glyph b="A" family={family} /> marca pronto.
                  </>
                ) : device === 'toque' ? (
                  <>Toque num lutador e depois em Pronto.</>
                ) : (
                  <>
                    <Key k="←" /> <Key k="→" /> trocam o lutador, <Key k="Enter" /> marca pronto.
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="briga-keys">Você está assistindo. Na próxima luta dá para entrar.</p>
          )}
        </div>
      </footer>
      <PickTools {...p} />
    </div>
  )
}

function WhoChip({ p, color, you }: { p: BrawlPlayerView; color?: string; you: boolean }): ReactElement {
  return (
    <span className={`briga-who ${p.ready ? 'ready' : ''} ${you ? 'you' : ''}`} style={{ borderColor: color }} title={p.name}>
      {p.bot ? <i className="briga-bot" aria-hidden="true" /> : <Avatar name={p.name} size={20} />}
      <span className="n">{you ? 'Você' : p.name}</span>
      {p.ready && <Icon name="check" size={12} />}
    </span>
  )
}

function PickTools(p: BrawlHudProps): ReactElement {
  return (
    <div className="briga-tools">
      {p.onMusicOn && (
        <button className={`icon-btn ${p.musicOn ? 'on' : ''}`} onClick={() => p.onMusicOn?.(!p.musicOn)} data-tip={p.musicOn ? 'Desligar a música' : 'Ligar a música'} aria-label="Música" aria-pressed={!!p.musicOn}>
          <Icon name="music" size={20} />
        </button>
      )}
      {p.musicOn && p.onMusicVolume && <VolumeSlider value={p.musicVolume ?? 0.35} onChange={p.onMusicVolume} label="Volume da música" />}
      {p.onBackToScreens && (
        <button className="icon-btn" onClick={p.onBackToScreens} data-tip="Voltar às telas" aria-label="Voltar às telas">
          <Icon name="grid" size={20} />
        </button>
      )}
      {p.canManage && (
        <button className="icon-btn" onClick={p.onClose} data-tip="Encerrar a partida" aria-label="Encerrar a partida">
          <Icon name="x" size={18} />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- durante a luta

function FighterBlock({ f, p, color, mine, compact, lastStock }: { f: FighterSnap; p: BrawlPlayerView | undefined; color: string; mine: boolean; compact: boolean; lastStock: boolean }): ReactElement {
  const prev = useRef(f.damage)
  const [bump, setBump] = useState(0)
  useEffect(() => {
    if (f.damage > prev.current) setBump((n) => n + 1)
    prev.current = f.damage
  }, [f.damage])
  const dmg = Math.round(f.damage)
  const name = p?.name ?? `Lutador ${f.slot + 1}`
  return (
    <li className={`briga-fighter ${mine ? 'mine' : ''} ${f.out ? 'out' : ''} ${f.eliminated ? 'dead' : ''} ${compact ? 'compact' : ''}`} style={{ ['--tint' as string]: color }} aria-label={`${name}: ${dmg} de dano, ${f.stocks} vidas`}>
      <span className="briga-fighter-art">
        <Portrait char={f.char} tint={color} scale={compact ? 2 : 3} anim={f.eliminated ? 'hurt' : 'idle'} />
      </span>
      <span className="briga-fighter-info">
        <span className="briga-fighter-name">
          {name}
          {mine && <em> (você)</em>}
        </span>
        <span key={bump} className={`briga-dmg ${bump > 0 ? 'bump' : ''}`} style={{ color: damageColor(dmg) }}>
          {f.eliminated ? 'Fora' : `${dmg}`}
          {!f.eliminated && <small>%</small>}
        </span>
        <span className="briga-stocks" aria-hidden="true">
          {Array.from({ length: Math.max(0, f.stocks) }, (_, i) => (
            <img key={i} src={heartUrl(lastStock && f.stocks === 1 ? '#FF5A4A' : color)} alt="" className={f.stocks === 1 && lastStock ? 'last' : ''} draggable={false} />
          ))}
        </span>
      </span>
      {f.held !== 'mao' && (
        <span className="briga-held" aria-label={`Na mão: ${WEAPON_LABEL[f.held]}`}>
          <WeaponIcon weapon={f.held} />
        </span>
      )}
    </li>
  )
}

function Scoreboard({ lines, players, colors, you, title }: { lines: readonly BrawlScoreLine[]; players: readonly BrawlPlayerView[]; colors: Record<number, string>; you: string | null; title: string }): ReactElement {
  return (
    <div className="tiro-board briga-board pixel-font" role="dialog" aria-label={title}>
      <strong>{title}</strong>
      <table>
        <thead>
          <tr>
            <th scope="col">Lutador</th>
            <th scope="col">Nocautes</th>
            <th scope="col">Quedas</th>
            <th scope="col">Dano</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((s) => {
            const pl = players.find((x) => x.id === s.id)
            return (
              <tr key={s.id} className={s.id === you ? 'me' : ''}>
                <th scope="row">
                  <i className="golf-dot" style={{ background: pl ? colors[pl.slot] : '#B7A99A' }} aria-hidden="true" />
                  {pl?.name ?? 'Lutador'}
                </th>
                <td>{s.kos}</td>
                <td>{s.falls}</td>
                <td>{Math.round(s.damage)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface FeedItem {
  id: number
  text: ReactNode
  mine: boolean
  at: number
}

const FEED_MS = 5000

function Hints({ device, family }: { device: ReturnType<typeof useInputDevice>['device']; family: ReturnType<typeof useInputDevice>['family'] }): ReactElement {
  if (device === 'controle') {
    const g = (b: Parameters<typeof Glyph>[0]['b']) => <Glyph b={b} family={family} />
    return (
      <div className="briga-hints" aria-label="Controles">
        <span>{g('LS')} Anda</span>
        <span>{g('A')} Pula</span>
        <span>{g('X')} Golpe</span>
        <span>{g('Y')} Golpe forte</span>
        <span>{g('RB')} Esquiva</span>
        <span>{g('LB')} Pega ou joga a arma</span>
      </div>
    )
  }
  if (device === 'toque') {
    return (
      <div className="briga-hints" aria-label="Controles">
        <span>Joystick à esquerda anda</span>
        <span>Botões à direita: pula, golpe, golpe forte, esquiva e pega</span>
      </div>
    )
  }
  return (
    <div className="briga-hints" aria-label="Controles">
      <span><Key k="A" /><Key k="D" /> Andam</span>
      <span><Key k="W" /> ou <Key k="Espaço" /> Pula</span>
      <span><Key k="J" /> Golpe</span>
      <span><Key k="K" /> Golpe forte (segure para carregar)</span>
      <span><Key k="L" /> Esquiva</span>
      <span><Key k="H" /> Pega ou joga a arma</span>
      <span><Key k="S" /> Cai rápido</span>
    </div>
  )
}

function BrawlLive(p: BrawlHudProps): ReactElement | null {
  const { session, view, you, colors } = p
  const snap = useSnap(session)
  const { device, family } = useInputDevice()
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [board, setBoard] = useState(false)
  const [hints, setHints] = useState(true)
  const seq = useRef(0)
  const playersRef = useRef(view.players)
  playersRef.current = view.players
  const meRef = useRef<number | null>(null)
  meRef.current = snap?.me ?? null

  // feed de nocautes
  useEffect(() => {
    if (!session) return
    return session.onEvents((evs: BrawlFrameEvent[]) => {
      const now = performance.now()
      for (const e of evs) {
        if (e.type !== 'ko') continue
        const name = (slot: number) => playersRef.current.find((x) => x.slot === slot)?.name ?? 'Alguém'
        const text: ReactNode = e.killer >= 0 && e.killer !== e.victim ? <>{name(e.killer)} nocauteou {name(e.victim)}</> : <>{name(e.victim)} caiu</>
        setFeed((f) => [...f.slice(-3), { id: ++seq.current, text, mine: e.killer === meRef.current, at: now }])
      }
    })
  }, [session])
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = performance.now()
      setFeed((f) => (f.some((x) => now - x.at > FEED_MS) ? f.filter((x) => now - x.at <= FEED_MS) : f))
    }, 400)
    return () => window.clearInterval(t)
  }, [])
  // as dicas somem sozinhas depois de um tempo (o botão de ajuda traz de volta)
  useEffect(() => {
    const t = window.setTimeout(() => setHints(false), 40_000)
    return () => window.clearTimeout(t)
  }, [])

  // Tab segura o placar (sem atrapalhar quem digita no chat)
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
    }
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || typing(e.target) || e.ctrlKey || e.altKey || e.metaKey) return
      e.preventDefault()
      setBoard(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Tab') setBoard(false)
    }
    const off = () => setBoard(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', off)
    }
  }, [])

  if (!snap) {
    return (
      <div className="briga-hud" aria-live="polite">
        <div className="tiro-wait pixel-font">Conectando à luta…</div>
      </div>
    )
  }

  const over = snap.phase === 'fim' || view.phase === 'fim'
  const timed = view.options.mode === 'tempo'
  const meView = view.players.find((x) => x.id === you)
  const watching = snap.me === null || !!meView?.spectating || (snap.me !== null && !snap.fighters.some((f) => f.slot === snap.me))
  const compact = snap.fighters.length > 6
  const anyLast = !timed && view.options.stocks > 1 && snap.fighters.some((f) => f.stocks === 1 && !f.eliminated)
  const lines: BrawlScoreLine[] = view.ranking ?? view.scores
  const hurry = timed && snap.phase === 'jogando' && snap.timeLeftMs > 0 && snap.timeLeftMs <= 30_000

  return (
    <div className={`briga-hud ${hurry ? 'hurry' : ''}`}>
      <div className="sr-only" aria-live="polite">
        {snap.phase === 'morte-subita' ? 'Morte súbita' : ''}
      </div>

      <div className="briga-top pixel-font">
        {timed && snap.phase !== 'morte-subita' && (
          <div className={`briga-clock ${hurry ? 'hurry' : ''}`} role="timer" aria-label="Tempo que falta">
            <strong>{formatClock(snap.phase === 'contagem' ? view.options.minutes * 60_000 : snap.timeLeftMs)}</strong>
          </div>
        )}
        {snap.phase === 'morte-subita' && (
          <div className="briga-clock sudden" role="status">
            <strong>Morte súbita</strong>
            <small>O próximo nocaute decide</small>
          </div>
        )}
      </div>

      <ul className="tiro-feed briga-feed pixel-font" aria-label="Últimos nocautes">
        {feed.map((f) => (
          <li key={f.id} className={f.mine ? 'mine' : ''}>
            {f.text}
          </li>
        ))}
      </ul>

      {watching && !over && (
        <div className="briga-watch pixel-font" role="status">
          <strong>Você está assistindo</strong>
          <small>Entra na próxima luta.</small>
        </div>
      )}

      {hints && !watching && !over && (
        <div className="briga-hints-wrap pixel-font">
          <Hints device={device} family={family} />
        </div>
      )}

      <ul className="briga-strip pixel-font" aria-label="Lutadores">
        {snap.fighters.map((f) => (
          <FighterBlock key={f.slot} f={f} p={view.players.find((x) => x.slot === f.slot)} color={colors[f.slot] ?? '#F3EBDD'} mine={f.slot === snap.me} compact={compact} lastStock={anyLast} />
        ))}
      </ul>

      <div className="tiro-tools briga-net-tools">
        <span className={`tiro-net ${snap.net}`} role="status">
          {netLabel(snap.net, snap.pingMs)}
        </span>
        <button className={`icon-btn ${board ? 'on' : ''}`} onClick={() => setBoard((b) => !b)} data-tip={device === 'controle' ? 'Placar' : device === 'toque' ? 'Placar' : 'Placar (Tab)'} aria-label="Placar" aria-pressed={board}>
          <Icon name="chart" size={20} />
        </button>
        {p.onMusicOn && (
          <button className={`icon-btn ${p.musicOn ? 'on' : ''}`} onClick={() => p.onMusicOn?.(!p.musicOn)} data-tip={p.musicOn ? 'Desligar a música' : 'Ligar a música'} aria-label="Música" aria-pressed={!!p.musicOn}>
            <Icon name="music" size={20} />
          </button>
        )}
        {p.musicOn && p.onMusicVolume && <VolumeSlider value={p.musicVolume ?? 0.35} onChange={p.onMusicVolume} label="Volume da música" />}
        <button className={`icon-btn ${hints ? 'on' : ''}`} onClick={() => setHints((h) => !h)} data-tip="Como jogar" aria-label="Como jogar" aria-pressed={hints}>
          <Icon name="help" size={20} />
        </button>
        {p.onBackToScreens && (
          <button className="icon-btn" onClick={p.onBackToScreens} data-tip="Voltar às telas" aria-label="Voltar às telas">
            <Icon name="grid" size={20} />
          </button>
        )}
      </div>

      {board && !over && <Scoreboard lines={view.scores.length ? view.scores : lines} players={view.players} colors={colors} you={you} title={device === 'controle' ? `Placar (${padLabel('View', family)})` : 'Placar'} />}

      {over && <BrawlEnd {...p} lines={lines} />}
    </div>
  )
}

// ---------------------------------------------------------------- fim

function BrawlEnd(p: BrawlHudProps & { lines: BrawlScoreLine[] }): ReactElement {
  const { view, you, colors, lines } = p
  const { top, rest } = podiumOf(lines)
  const youWon = lines[0]?.id === you
  const nameOf = (id: string) => view.players.find((x) => x.id === id)?.name ?? 'Lutador'
  const slotOf = (id: string) => view.players.find((x) => x.id === id)?.slot ?? 0
  const poses = ['win', 'idle', 'hurt'] as const
  return (
    <div className="modal-backdrop">
      <div className="modal ranking tiro-ranking briga-ranking pixel-font" role="dialog" aria-modal="true" aria-label="Fim da luta">
        <h2>{youWon ? 'Você ganhou!' : lines[0] ? `${nameOf(lines[0].id)} ganhou!` : 'Fim da luta'}</h2>
        <ol className="tiro-podium briga-podium" aria-label="Pódio">
          {[1, 0, 2].map((i) => {
            const r = top[i]
            if (!r) return <li key={i} className="empty" aria-hidden="true" />
            return (
              <li key={r.id} className={`place-${i + 1} ${r.id === you ? 'me' : ''}`}>
                <Portrait char={r.char} tint={colors[slotOf(r.id)] ?? '#F3EBDD'} anim={poses[i]} frame={i === 0 ? 1 : 0} scale={i === 0 ? 5 : 4} />
                <span className="n">{nameOf(r.id)}</span>
                <span className="k">
                  {r.kos} nocautes, {r.falls} quedas
                </span>
                <span className="step">{i + 1}º</span>
              </li>
            )
          })}
        </ol>
        <table className="briga-score-table">
          <thead>
            <tr>
              <th scope="col">Lutador</th>
              <th scope="col">Nocautes</th>
              <th scope="col">Quedas</th>
              <th scope="col">Dano</th>
            </tr>
          </thead>
          <tbody>
            {[...top, ...rest].map((r, i) => (
              <tr key={r.id} className={r.id === you ? 'me' : ''}>
                <th scope="row">
                  <span className="rank-place">{i + 1}º</span>
                  <i className="golf-dot" style={{ background: colors[slotOf(r.id)] ?? '#B7A99A' }} aria-hidden="true" />
                  {nameOf(r.id)}
                </th>
                <td>{r.kos}</td>
                <td>{r.falls}</td>
                <td>{Math.round(r.damage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal-actions">
          {p.onBackToScreens && <button onClick={p.onBackToScreens}>Voltar às telas</button>}
          {p.canManage && (
            <button className="danger" onClick={p.onClose}>
              Fechar
            </button>
          )}
          {p.canManage && (
            <button className="primary" onClick={p.onPlayAgain}>
              Jogar de novo
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- entrada

export function BrawlHud(p: BrawlHudProps): ReactElement | null {
  if (p.hidden) return null
  if (p.view.phase === 'escolha') return <BrawlPick {...p} />
  return <BrawlLive {...p} />
}
