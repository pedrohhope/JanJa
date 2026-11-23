import { rankOf, suitOf, type Card } from '../../../../shared/games/truco/cards'
import { runs, SUIT_INK, SUIT_SPRITES } from './pixel'

export function CardFace({ card, width }: { card: Card; width: number }) {
  const s = suitOf(card)
  return (
    <svg className="tr-card" viewBox="0 0 30 45" width={width} height={width * 1.5} shapeRendering="crispEdges" aria-hidden="true">
      <rect x="0.5" y="0.5" width="29" height="44" rx="2.5" fill="#F3EBDD" stroke="#0F0B09" />
      <text x="3" y="9.5" className="tr-rank" fill={SUIT_INK[s]}>
        {rankOf(card)}
      </text>
      <text x="27" y="42" className="tr-rank" textAnchor="end" fill={SUIT_INK[s]}>
        {rankOf(card)}
      </text>
      <g transform="translate(6 13.5) scale(2)">
        {runs(SUIT_SPRITES[s]).map((r) => (
          <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
        ))}
      </g>
    </svg>
  )
}

export function CardBack({ width }: { width: number }) {
  return (
    <svg className="tr-card" viewBox="0 0 30 45" width={width} height={width * 1.5} shapeRendering="crispEdges" aria-hidden="true">
      <rect x="0.5" y="0.5" width="29" height="44" rx="2.5" fill="#3B312C" stroke="#0F0B09" />
      <rect x="3" y="3" width="24" height="39" rx="1.5" fill="none" stroke="#E0A92E" />
      <path d="M15 12 L21 22.5 L15 33 L9 22.5 Z" fill="#FFC94A" />
    </svg>
  )
}
