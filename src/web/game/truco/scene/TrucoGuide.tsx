import { cardName, RANKING, RANKING_NAMES, type Card } from '../../../../shared/games/truco/cards'
import { CONTRAFLOR_POINTS, FLOR_POINTS, TARGET } from '../../../../shared/games/truco/types'
import { CardFace } from './CardFace'


/** Painel ao lado da mesa: a ordem das cartas (as suas destacadas) e as regras da nossa mesa. */
export function TrucoGuide({ mine, onClose }: { mine: readonly Card[]; onClose: () => void }) {
  const have = new Set(mine)
  return (
    <aside className="tr-guide" aria-label="Regras do truco">
      <header>
        <strong className="pixel-font">Regras</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar as regras" data-tip="Fechar as regras">
          ×
        </button>
      </header>

      <section>
        <h3>Ordem das cartas</h3>
        <small className="tr-guide-note">Da mais forte para a mais fraca. As suas brilham.</small>
        <ol className="tr-rank-list">
          {RANKING.map((tier, k) => (
            <li key={k} className={tier.some((c) => have.has(c)) ? 'has' : ''}>
              <span className="tr-rank-n">{k + 1}</span>
              <span className="tr-rank-name">{RANKING_NAMES[k]}</span>
              <span className="tr-rank-cards">
                {tier.map((c) => (
                  <span key={c} className={have.has(c) ? 'mine' : ''} title={cardName(c)} aria-label={cardName(c)} role="img">
                    <CardFace card={c} width={22} />
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
        <small className="tr-guide-note">Cartas do mesmo grupo empatam (vaza parda).</small>
      </section>

      <section>
        <h3>A mão</h3>
        <ul>
          <li>Ganha a mão quem fizer 2 das 3 vazas.</li>
          <li>Vaza parda (empate) na primeira: leva quem ganhar a próxima. Parda depois: leva quem fez a primeira. Tudo pardo: ganha quem é mão.</li>
          <li>Partida até {TARGET} pontos.</li>
        </ul>
      </section>

      <section>
        <h3>Truco</h3>
        <ul>
          <li>Truco vale 2, retruco 3 e vale quatro 4.</li>
          <li>Não quis: quem pediu leva o que valia antes.</li>
          <li>Só pode aumentar quem aceitou o último pedido.</li>
          <li>Ir ao baralho: os outros levam o que a mão vale.</li>
        </ul>
      </section>

      <section>
        <h3>Envido</h3>
        <ul>
          <li>Só na primeira vaza. O envido está primeiro: dá para cantar mesmo depois do truco.</li>
          <li>Duas do mesmo naipe: 20 mais as duas. Senão, vale a maior carta. Sota, cavalo e rei valem 0.</li>
          <li>Envido vale 2, real envido 3. Falta envido vale o que falta para quem está na frente chegar a {TARGET}.</li>
          <li>Não quis: quem cantou leva 1, ou a soma do que foi cantado antes do último.</li>
          <li>Empate no envido: ganha quem está mais perto da mão.</li>
        </ul>
      </section>

      <section>
        <h3>Flor</h3>
        <ul>
          <li>Três do mesmo naipe. O jogo canta sozinho e vale {FLOR_POINTS}.</li>
          <li>Com flor não tem envido. Contra-flor vale {CONTRAFLOR_POINTS}.</li>
        </ul>
      </section>
    </aside>
  )
}
