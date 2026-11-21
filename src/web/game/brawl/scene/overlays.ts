/**
 * Efeitos desenhados DENTRO do quadro do lutador, depois do contorno (sem tinta de jogador): as assinaturas dos
 * golpes fortes (cartas, vapor, estática, janela...), o vapor da Xícara e as faíscas da vitória.
 */
import type { CharacterId } from '../../../../shared/games/brawl/types'
import { AX, FEET, G } from './grid'
import type { Pose } from './pose'

const cosd = (d: number) => Math.cos((d * Math.PI) / 180)
const sind = (d: number) => Math.sin((d * Math.PI) / 180)

/** vapor da Xícara: 3 fiapos subindo, deslocados por quadro */
export function steam(g: G, p: Pose, x: number, y: number, strong = false): void {
  const t = p.t
  for (let k = 0; k < 3; k++) {
    const bx = x + k * 3 - 3 + Math.round(p.pomp / 2)
    const n = strong ? 8 : 5 + (k % 2)
    for (let j = 0; j < n; j++) {
      const ph = (t + j * 0.7 + k * 1.3) % 4
      const wob = Math.round(Math.sin(ph * 1.6) * 1.2)
      const ch = j > n - 3 ? 'd' : j > n - 5 ? 'P' : 'p'
      if ((j + k + t) % 3 !== 0 || strong) g.put(bx + wob, y - 1 - j, ch)
    }
  }
}

export function sparkle(g: G, p: Pose, cx: number, cy: number): void {
  const t = p.t
  const pts: [number, number][] = [
    [-9, -2],
    [10, -6],
    [-6, -10],
    [8, 2]
  ]
  pts.forEach(([dx, dy], i) => {
    const on = (t + i) % 4
    const x = cx + dx
    const y = cy + dy - (on === 0 ? 1 : 0)
    if (on === 3) return
    g.put(x, y, i % 2 ? 'u' : 'y')
    if (on < 2) {
      g.put(x - 1, y, 'u')
      g.put(x + 1, y, 'u')
      g.put(x, y - 1, 'u')
      g.put(x, y + 1, 'u')
    }
  })
}

function card(g: G, x: number, y: number, rot: number): void {
  // carta pequena 3x4 (de lado se rot = 1)
  if (rot % 2 === 0) {
    g.rect(x, y, 3, 4, 'p')
    g.put(x, y, 'k')
    g.put(x + 2, y + 3, 'K')
    g.put(x + 1, y + 1, 'K')
  } else {
    g.rect(x, y + 1, 4, 3, 'p')
    g.put(x + 1, y + 2, 'k')
    g.put(x + 2, y + 2, 'K')
  }
}

/** pinta o efeito `ov` do personagem no instante `t` (0..1 do golpe, ou do ciclo) */
export function paintOverlay(g: G, char: CharacterId, p: Pose): void {
  const ov = p.ov
  const t = p.ovT ?? 0
  const cx = AX
  const topY = 7 + p.dy
  if (char === 'xicara' && ov !== 'spin' && ov !== 'spill') steam(g, p, AX + 1 + Math.trunc(p.lean / 2), 10 + p.dy, ov === 'steam-jet')
  if (!ov) return
  switch (ov) {
    // ---------------------------------------------------------------- Jan
    case 'cards-orbit': {
      const n = 5
      for (let i = 0; i < n; i++) {
        const a = t * 360 * 1.2 + i * (360 / n)
        const r = 8 + t * 6
        card(g, Math.round(cx + 2 + cosd(a) * r * 1.2) - 1, Math.round(topY + 14 + sind(a) * r * 0.8) - 2, Math.round(a / 90))
      }
      break
    }
    case 'cards-wind': {
      for (let i = 0; i < 3; i++) card(g, cx + 6 + i * 4, topY + 8 - i * 2 + Math.round(t * 2), i)
      break
    }
    case 'shoulder': {
      // linhas de velocidade atrás
      for (let i = 0; i < 5; i++) g.rect(0, topY + 8 + i * 3, 3 + (i % 2) * 3, 1, i % 2 ? 'd' : 'p')
      break
    }
    case 'shuffle': {
      for (const sx of [cx - 9, cx + 11]) for (let i = 0; i < 3; i++) card(g, sx, FEET - 4 - Math.round(t * 10) - i * 5, i + 1)
      break
    }
    // ---------------------------------------------------------------- Xícara
    case 'steam-jet':
      break // o vapor forte já saiu acima
    case 'spill': {
      // café escorrendo para a frente e rastro no chão
      for (let i = 0; i < 9; i++) g.put(cx + 8 + i, topY + 4 + Math.round(i * i * 0.07 * (1 + t)), i % 3 === 0 ? 'M' : 'm')
      for (let i = 0; i < 5; i++) g.put(cx - 10 - i, FEET, i % 2 ? 'm' : 'n')
      break
    }
    case 'spin': {
      // faixas de giro em volta do corpo
      for (let r = 0; r < 4; r++) {
        const y = topY + 3 + r * 4
        const off = Math.round(t * 6 + r * 2) % 8
        g.rect(cx - 9 + off, y, 4, 1, 'p')
        g.rect(cx + 6 - off, y + 1, 3, 1, 'd')
      }
      break
    }
    // ---------------------------------------------------------------- Tevê
    case 'static': {
      for (let i = 0; i < 46; i++) {
        const a = (i * 137 + p.t * 71) % 360
        const r = 12 + ((i * 53 + p.t * 17) % 5)
        const x = Math.round(cx + cosd(a) * r)
        const y = Math.round(topY + 12 + sind(a) * r * 0.8)
        g.put(x, y, (i + p.t) % 3 === 0 ? 'p' : (i + p.t) % 3 === 1 ? 'D' : 'd')
      }
      break
    }
    case 'bolt': {
      // raio catódico: zigue-zague da tela para a frente
      let x = cx + 9
      let y = topY + 11
      for (let i = 0; i < 9; i++) {
        const nx = x + 3
        const ny = y + (i % 2 ? 3 : -3) * (1 - t * 0.4)
        g.line(x, y, nx, ny, i % 2 ? 'u' : 'y')
        g.put(x, y - 1, 'p')
        x = nx
        y = Math.round(ny)
      }
      break
    }
    case 'collapse': {
      // onda de choque no chão
      const r = 4 + t * 14
      for (const s of [-1, 1]) {
        for (let i = 0; i < 4; i++) g.put(Math.round(cx + 2 + s * (r + i)), FEET - i * (t > 0.3 ? 1 : 0), i === 0 ? 'p' : 'd')
      }
      break
    }
    // ---------------------------------------------------------------- JanJa
    case 'window': {
      // moldura de janela pixel se abrindo em volta dela
      const k = Math.min(1, 0.35 + t * 0.8)
      const w = Math.round(30 * k)
      const h = Math.round(29 * k)
      const x0 = Math.round(cx + 2 - w / 2)
      const y0 = FEET + 1 - h
      g.rect(x0, y0, w, h, 'k')
      for (let i = 1; i < w - 1; i++) {
        g.put(x0 + i, y0, 'k')
        g.put(x0 + i, y0 + h - 1, 'k')
      }
      // barra de título amarela com 3 pontinhos
      g.rect(x0 + 1, y0 + 1, w - 2, 4, 'y')
      g.put(x0 + 3, y0 + 2, 'o')
      g.put(x0 + 5, y0 + 2, 'u')
      g.put(x0 + 7, y0 + 2, 'g')
      g.rect(x0 + 1, y0 + h - 2, w - 2, 1, 'Y')
      // o miolo fica vazio (ela aparece): pinta só as bordas
      for (let j = y0 + 5; j < y0 + h - 2; j++)
        for (let i = x0 + 1; i < x0 + w - 1; i++) if (i > x0 + 1 && i < x0 + w - 2) g.clear(i, j)
      for (let j = y0 + 5; j < y0 + h - 1; j++) {
        g.put(x0 + 1, j, 'p')
        g.put(x0 + w - 2, j, 'P')
      }
      break
    }
    case 'wifi': {
      const baseX = cx + 11
      const baseY = topY + 10
      for (let i = 0; i < 3; i++) {
        const r = 3 + i * 3
        for (let a = -50; a <= 50; a += 14) g.put(Math.round(baseX + i * 2 + cosd(a) * r), Math.round(baseY + sind(a) * r), i === 2 ? 'g' : i === 1 ? 'u' : 'p')
      }
      break
    }
    case 'mic': {
      // anéis de onda sonora no chão
      for (let i = 0; i < 3; i++) {
        const r = 5 + i * 5 + t * 5
        for (let a = 0; a < 360; a += 12) {
          const x = Math.round(cx + 2 + cosd(a) * r)
          const y = Math.round(FEET - 1 + sind(a) * r * 0.22)
          g.put(x, y, i === 0 ? 'u' : i === 1 ? 'p' : 'd')
        }
      }
      break
    }
    case 'sparkle':
      sparkle(g, p, cx + 2, topY + 4)
      break
    default:
      break
  }
  if (ov === 'sparkle') return
}
