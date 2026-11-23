import '@fontsource-variable/pixelify-sans'
import type { PifeView } from '../../shared/games/pife/types'
import { formatClock } from '../game/helpers'
import { useServerNow } from '../game/useServerNow'
import { Icon } from './icons'
import { VolumeSlider } from './media'

interface Props {
  view: PifeView
  canManage: boolean
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens: () => void
  musicOn: boolean
  musicVolume: number
  onMusicOn: (on: boolean) => void
  onMusicVolume: (v: number) => void
}

/** Barra de baixo do pife: de quem é a vez, o que fazer, o prazo e o fim da rodada. Os botões da vez ficam na mesa. */
export function PifeHud(p: Props) {
  const { view } = p
  const now = useServerNow(view.serverNow, 500)
  const me = view.you?.index ?? null
  const name = (i: number) => (i === me ? 'Você' : (view.players[i]?.name ?? 'Alguém'))
  const myTurn = me !== null && view.turn === me
  const left = view.until !== null ? view.until - now : null
  const over = view.phase === 'fim' && view.winner

  let title: string
  let help: string
  if (over) {
    title = 'Fim da rodada'
    help = `${name(view.winner!.p)} bateu${view.winner!.discard ? '' : ' com todas as cartas'}. As mãos de todo mundo estão na mesa.`
  } else if (myTurn && view.phase === 'comprar') {
    title = 'Sua vez'
    help = 'Compre do monte (M) ou pegue a carta de cima do lixo (L).'
  } else if (myTurn) {
    title = 'Sua vez'
    help = view.canWin
      ? 'Suas cartas fecham em jogos: aperte Bater (B)!'
      : 'Escolha uma carta e descarte (clique de novo nela, no lixo ou D). Arraste para arrumar a mão.'
  } else {
    title = view.turn !== null ? `Vez de ${name(view.turn)}` : ''
    help = me === null ? 'Você está assistindo.' : 'Arrume a sua mão enquanto espera: arraste as cartas ou use Organizar (O).'
  }

  return (
    <div className={`poker-hud pf-hud ${myTurn ? 'my-turn' : ''}`}>
      <div className="hud-row">
        <div className="hud-help">
          <strong className="pixel-font">{title}</strong>
          <small className="detail">{help}</small>
        </div>
        {over && p.canManage && (
          <div className="hud-actions">
            <button className="act primary" onClick={p.onPlayAgain}>
              Jogar de novo
            </button>
            <button className="act danger" onClick={p.onClose}>
              Encerrar
            </button>
          </div>
        )}
        <div className="hud-tools">
          {left !== null && !over && <span className={`hud-clock ${left < 8000 ? 'golf-hurry' : ''}`}>{formatClock(left)}</span>}
          <button
            className={`icon-btn ${p.musicOn ? 'on' : ''}`}
            onClick={() => p.onMusicOn(!p.musicOn)}
            data-tip={p.musicOn ? 'Desligar a música' : 'Ligar a música'}
            aria-label="Música"
            aria-pressed={p.musicOn}
          >
            <Icon name="music" size={20} />
          </button>
          {p.musicOn && <VolumeSlider value={p.musicVolume} onChange={p.onMusicVolume} label="Volume da música" />}
          <button className="icon-btn" onClick={p.onBackToScreens} data-tip="Voltar às telas" aria-label="Voltar às telas">
            <Icon name="grid" size={20} />
          </button>
        </div>
      </div>
    </div>
  )
}
