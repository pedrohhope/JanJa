/**
 * Os 4 corpos. Cada rig desenha cabeça, tronco, pernas e braços para uma `Pose`, sem contorno
 * (o contorno `t` é gerado depois, em volta de tudo). Quadro 32x32, pivô do corpo na coluna AX = 12, pés na linha 30.
 */
import type { CharacterId, Held } from '../../../../shared/games/brawl/types'
import { AX, FEET, G, type Rows } from './grid'
import type { Face, Pose } from './pose'
import { drawGlove, drawWeapon } from './weapons'

export interface Rig {
  id: CharacterId
  shoulders(p: Pose): { fx: number; fy: number; bx: number; by: number }
  legBack(g: G, p: Pose): void
  legFront(g: G, p: Pose): void
  body(g: G, p: Pose): void
  arm(g: G, sx: number, sy: number, hx: number, hy: number, front: boolean): void
  /** cabeça/antena/vapor que passa por cima do contorno (não leva contorno) */
  over?(g: G, p: Pose): void
}

/** braço de 2 px de espessura de (sx,sy) até a mão em (hx,hy) */
function limb(g: G, sx: number, sy: number, hx: number, hy: number, main: string, edge: string): void {
  const horiz = Math.abs(hx - sx) > Math.abs(hy - sy)
  g.line(sx, sy, hx, hy, main)
  if (horiz) g.line(sx, sy + 1, hx, hy + 1, edge)
  else g.line(sx + 1, sy, hx + 1, hy, edge)
}

function hand(g: G, hx: number, hy: number, ch: string): void {
  g.rect(Math.round(hx), Math.round(hy), 2, 2, ch)
}

/** perna reta de (hipX,hipY) até o pé (footX,footY) com `w` de largura */
function leg(g: G, hipX: number, hipY: number, footX: number, footY: number, w: number, pants: string, shoe: string, shoeLen: number): void {
  const n = Math.max(1, footY - hipY)
  for (let r = 0; r <= footY - hipY; r++) {
    const k = n === 0 ? 1 : r / n
    const x = Math.round(hipX + (footX - hipX) * k)
    const last = r === footY - hipY
    g.rect(x, hipY + r, w, 1, last ? shoe : pants)
  }
  // bico do sapato
  g.rect(Math.round(footX) + w, footY, shoeLen, 1, shoe)
  if (footY - 1 >= hipY) g.put(Math.round(footX) + w, footY - 1, shoe)
}

const eyeRowsFace = (g: G, x: number, y: number, face: Face, eyeXs: [number, number], ink = 'k'): void => {
  const [e1, e2] = eyeXs
  switch (face) {
    case 'blink':
    case 'sleepy':
      g.rect(x + e1, y + 1, 1, 1, ink)
      g.rect(x + e2, y + 1, 1, 1, ink)
      break
    case 'hurt':
      g.put(x + e1 - 1, y, ink)
      g.put(x + e1 + 1, y, ink)
      g.put(x + e1, y + 1, ink)
      g.put(x + e1 - 1, y + 2, ink)
      g.put(x + e1 + 1, y + 2, ink)
      g.put(x + e2 - 1, y, ink)
      g.put(x + e2 + 1, y, ink)
      g.put(x + e2, y + 1, ink)
      g.put(x + e2 - 1, y + 2, ink)
      g.put(x + e2 + 1, y + 2, ink)
      break
    case 'effort':
      g.rect(x + e1, y + 1, 1, 2, ink)
      g.rect(x + e2, y + 1, 1, 2, ink)
      g.put(x + e1 - 1, y, ink)
      g.put(x + e2 + 1, y, ink)
      break
    case 'win':
      g.put(x + e1 - 1, y + 2, ink)
      g.put(x + e1, y + 1, ink)
      g.put(x + e1 + 1, y + 2, ink)
      g.put(x + e2 - 1, y + 2, ink)
      g.put(x + e2, y + 1, ink)
      g.put(x + e2 + 1, y + 2, ink)
      break
    case 'scared':
      g.rect(x + e1, y, 1, 3, ink)
      g.rect(x + e2, y, 1, 3, ink)
      g.put(x + e1 + 1, y, 'p')
      g.put(x + e2 + 1, y, 'p')
      break
    case 'smug':
      g.rect(x + e1, y + 1, 2, 1, ink)
      g.rect(x + e2, y + 1, 2, 1, ink)
      break
    default:
      g.rect(x + e1, y, 1, 2, ink)
      g.rect(x + e2, y, 1, 2, ink)
  }
}

// ======================================================================================= JAN

const JAN_HEAD: Rows = [
  '....yyyy....', // pompom
  '...yuyyyY...',
  '....yYYy....',
  '..yyyyyyyy..', // gorro
  '.yyuuyyyyyY.',
  'yyyuyyyyyyyY',
  'yyyyyyyyyyyY',
  'YYYYYYYYYYYY', // barra do gorro
  'ssssssssssss', // testa
  'ssssssssssss', // olhos (linhas 9 e 10, pintados por `eyeRowsFace`)
  'ssssssssssss',
  'sSsssssssSss',
  '.ssssssssss.',
  '.kkkkkkkkkk.' // queixo
]

function janHead(g: G, x: number, y: number, p: Pose): void {
  const rows = JAN_HEAD.map((l) => l)
  g.stamp(x, y, rows)
  // pompom atrasa em relação à cabeça
  if (p.pomp) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 12; c++) g.clear(x + c, y + r)
    g.stamp(x + Math.max(-2, Math.min(2, p.pomp)), y, JAN_HEAD.slice(0, 3))
    g.stamp(x, y + 2, ['....yYYy....'])
  }
  eyeRowsFace(g, x, y + 9, p.face, [5, 9])
  if (p.face === 'effort' || p.face === 'hurt' || p.face === 'win' || p.face === 'scared') {
    const mouth = p.face === 'win' ? ['.kkkk.', '.kqqk.'] : p.face === 'scared' ? ['kk', 'kk'] : ['kkkk']
    g.stamp(x + (p.face === 'scared' ? 6 : 4), y + 12 - (mouth.length === 1 ? 0 : 1), mouth)
    g.put(x + 5, y + 12, 'q')
  }
  if (p.face === 'smug') g.stamp(x + 6, y + 12, ['kk'])
}

export const janRig: Rig = {
  id: 'jan',
  shoulders(p) {
    const top = 7 + p.dy
    const lx = Math.trunc(p.lean / 2)
    return { fx: AX + 5 + lx, fy: top + 15, bx: AX - 7 + lx, by: top + 15 }
  },
  legBack(g, p) {
    const hip = 27 + p.dy
    leg(g, AX - 4, hip, AX - 4 + p.legs.b[0], FEET - p.legs.b[1], 3, 'b', 'k', 1)
  },
  legFront(g, p) {
    const hip = 27 + p.dy
    leg(g, AX, hip, AX + p.legs.f[0], FEET - p.legs.f[1], 3, 'b', 'k', 1)
  },
  body(g, p) {
    const top = 7 + p.dy
    const lx = Math.trunc(p.lean / 2)
    janHead(g, AX - 6 + p.lean, top, p)
    const tx = AX - 5 + lx
    // moletom: ombros, bolso canguru, cordões, barra
    g.stamp(tx, top + 14, [
      'oooooooooo',
      'oopoopoooo',
      'oOpOOpoooo',
      'oOOOOOOOOo',
      'oOOOOOOOOo',
      'OOOOOOOOOO'
    ])
    // cintura: as pernas começam aqui; linha de sombra
    g.put(tx, top + 15, 'o')
  },
  arm(g, sx, sy, hx, hy, front) {
    limb(g, sx, sy, hx, hy, front ? 'o' : 'O', front ? 'O' : 'q')
    hand(g, hx, hy, front ? 's' : 'S')
  }
}

// ======================================================================================= JANJA

const JANJA_HEAD: Rows = [
  '..mmmm......', // coque
  '.mMMmmm.....',
  '.mmmmmm.....',
  '..mmmmmmmm..', // cabelo
  '.mmyyyyyymm.', // arco do fone
  'mmyJmmmmmymm',
  'mmymmmmmmymm',
  'myymmmmmmyym', // franja
  'ymysssssssmy', // fone nas orelhas (y = concha)
  'yYysssssssYy',
  'yYysssssssYy',
  '.yysSssssSy.',
  '..mssssssm..',
  '...kkkkkk...'
]

function janjaHead(g: G, x: number, y: number, p: Pose): void {
  g.stamp(x, y, JANJA_HEAD)
  if (p.pomp) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) g.clear(x + c, y + r)
    g.stamp(x + Math.max(-2, Math.min(1, p.pomp)), y, JANJA_HEAD.slice(0, 3))
  }
  // franja volta para a testa
  g.stamp(x + 3, y + 8, ['mmmmmmmm'])
  g.stamp(x + 3, y + 9, ['m......m'])
  eyeRowsFace(g, x, y + 9, p.face, [5, 9])
  // microfone: haste curva da concha da frente até perto da boca
  g.put(x + 11, y + 11, 'k')
  g.put(x + 10, y + 12, 'k')
  g.put(x + 9, y + 12, 'k')
  g.put(x + 8, y + 12, 'y')
  // LED verde da concha pisca
  g.put(x + 1, y + 10, p.t % 2 === 0 ? 'g' : 'G')
  g.put(x + 10, y + 9, p.t % 2 === 0 ? 'g' : 'G')
  if (p.face === 'effort' || p.face === 'hurt' || p.face === 'win' || p.face === 'scared') {
    const mouth = p.face === 'win' ? ['kkkk', 'kqqk'] : p.face === 'scared' ? ['kk', 'kk'] : ['kkk']
    g.stamp(x + 5, y + 12 - (mouth.length > 1 ? 1 : 0), mouth)
  } else g.put(x + 6, y + 12, 'o')
}

export const janjaRig: Rig = {
  id: 'janja',
  shoulders(p) {
    const top = 7 + p.dy
    const lx = Math.trunc(p.lean / 2)
    return { fx: AX + 4 + lx, fy: top + 15, bx: AX - 6 + lx, by: top + 15 }
  },
  legBack(g, p) {
    const hip = 27 + p.dy
    leg(g, AX - 3, hip, AX - 3 + p.legs.b[0], FEET - p.legs.b[1], 3, 'b', 'p', 1)
  },
  legFront(g, p) {
    const hip = 27 + p.dy
    leg(g, AX + 1, hip, AX + 1 + p.legs.f[0], FEET - p.legs.f[1], 3, 'b', 'p', 1)
  },
  body(g, p) {
    const top = 7 + p.dy
    const lx = Math.trunc(p.lean / 2)
    janjaHead(g, AX - 6 + p.lean, top, p)
    const tx = AX - 4 + lx
    // casaco creme com gola e barra coral
    g.stamp(tx, top + 14, [
      'pPoooPpp', // gola
      'ppPppPpp',
      'ppPppPpp',
      'ppPpppPp',
      'PPPPPPPP',
      'oooooooo' // barra coral
    ])
  },
  arm(g, sx, sy, hx, hy, front) {
    limb(g, sx, sy, hx, hy, front ? 'p' : 'P', front ? 'P' : 'd')
    g.put(sx, sy + 2 > hy ? hy : sy + 3, 'o')
    hand(g, hx, hy, front ? 's' : 'S')
    // punho coral
    const ux = Math.sign(sx - hx)
    const uy = Math.sign(sy - hy)
    g.put(Math.round(hx) + (ux > 0 ? 2 : -1), Math.round(hy) + (uy > 0 ? 1 : 0), 'o')
  }
}

// ======================================================================================= XÍCARA

const MUG_Y = 10

function mugBody(g: G, p: Pose): void {
  const top = MUG_Y + p.dy
  const bx = AX - 7 + Math.trunc(p.lean / 2)
  const W = 14
  const H = 16
  // corpo de porcelana
  for (let j = 0; j < H; j++) {
    const inset = j >= H - 2 ? 1 : 0
    for (let i = inset; i < W - inset; i++) {
      let ch = 'p'
      if (i >= W - 3) ch = 'P'
      if (i >= W - 1) ch = 'd'
      if (i === 1 || i === 2) ch = j < 3 ? 'p' : 'p'
      if (j >= H - 2) ch = i >= W - 4 ? 'd' : 'P'
      g.put(bx + i, top + j, ch)
    }
  }
  // brilho vertical
  g.rect(bx + 2, top + 4, 1, 6, 'x')
  // boca da xícara e café
  g.ellipse(bx + 6.5, top + 1.5, 7, 2.4, 'P')
  g.ellipse(bx + 6.5, top + 1.5, 6, 1.8, 'p')
  g.ellipse(bx + 6.5, top + 1.9, 5, 1.3, 'm')
  g.put(bx + 4, top + 1, 'M')
  g.put(bx + 5, top + 1, 'M')
  // faixa coral
  g.rect(bx + 1, top + 12, W - 2, 1, 'o')
  g.rect(bx + 1, top + 13, W - 3, 1, 'O')
  // rosto: olhos para a frente
  const fx = bx + 7
  eyeRowsFace(g, fx, top + 6, p.face, [1, 5], 'k')
  g.put(fx, top + 9, 'o')
  g.put(fx + 6, top + 9, 'o')
  if (p.face === 'effort' || p.face === 'hurt' || p.face === 'win' || p.face === 'scared') {
    g.stamp(fx + 2, top + 9, p.face === 'win' ? ['kkk', '.q.'] : p.face === 'scared' ? ['kk', 'kk'] : ['kkk'])
  } else g.stamp(fx + 2, top + 9, ['kk'])
  // alça (atrás)
  const hx = bx - 3
  g.ellipse(hx + 2, top + 8, 3, 4.6, 'P')
  g.ellipse(hx + 2.4, top + 8, 1.2, 3, '.')
  for (let j = 4; j <= 12; j++) for (let i = -1; i <= 4; i++) if (g.get(hx + i, top + j) === '.' && Math.abs(i - 2.4) < 1.3 && Math.abs(j - 8) < 3.2) g.clear(hx + i, top + j)
}

export const xicaraRig: Rig = {
  id: 'xicara',
  shoulders(p) {
    const top = MUG_Y + p.dy
    const lx = Math.trunc(p.lean / 2)
    return { fx: AX + 6 + lx, fy: top + 8, bx: AX - 8 + lx, by: top + 8 }
  },
  legBack(g, p) {
    const hip = MUG_Y + 16 + p.dy
    leg(g, AX - 4, hip, AX - 4 + p.legs.b[0], FEET - p.legs.b[1], 2, 'P', 'o', 2)
  },
  legFront(g, p) {
    const hip = MUG_Y + 16 + p.dy
    leg(g, AX + 1, hip, AX + 1 + p.legs.f[0], FEET - p.legs.f[1], 2, 'p', 'o', 2)
  },
  body: (g, p) => mugBody(g, p),
  arm(g, sx, sy, hx, hy, front) {
    g.line(sx, sy, hx, hy, front ? 'p' : 'P')
    g.line(sx, sy + (Math.abs(hx - sx) > Math.abs(hy - sy) ? 1 : 0), hx + (Math.abs(hx - sx) > Math.abs(hy - sy) ? 0 : 1), hy + (Math.abs(hx - sx) > Math.abs(hy - sy) ? 1 : 0), front ? 'P' : 'd')
    hand(g, hx, hy, front ? 'p' : 'P')
    g.put(hx + 1, hy + 1, 'd')
  }
}

// ======================================================================================= TEVÊ

const TV_Y = 10

function tvScreen(g: G, x: number, y: number, p: Pose): void {
  // vidro: azul poeirento com brilho; a "cara" é o rosto pixel
  g.rect(x, y, 12, 11, 'V')
  g.rect(x + 1, y + 1, 10, 9, 'v')
  // linhas de varredura sutis
  for (let r = 2; r < 10; r += 2) g.rect(x + 1, y + r, 10, 1, 'V')
  const ink = 'a'
  const f: Face = p.face
  const ex = x + 3
  const ey = y + 3
  if (f === 'sleepy' || f === 'blink') {
    g.rect(ex, ey + 1, 2, 1, ink)
    g.rect(ex + 4, ey + 1, 2, 1, ink)
  } else if (f === 'hurt') {
    for (const dx of [0, 4]) {
      g.put(ex + dx, ey, ink)
      g.put(ex + dx + 1, ey + 1, ink)
      g.put(ex + dx, ey + 2, ink)
      g.put(ex + dx + 1, ey, ink)
      g.put(ex + dx, ey + 1, 'V')
    }
  } else if (f === 'effort') {
    g.rect(ex, ey + 1, 2, 2, ink)
    g.rect(ex + 4, ey + 1, 2, 2, ink)
    g.line(ex - 1, ey - 1, ex + 1, ey, ink)
    g.line(ex + 6, ey - 1, ex + 4, ey, ink)
  } else if (f === 'win') {
    g.put(ex, ey + 2, ink)
    g.put(ex + 1, ey + 1, ink)
    g.put(ex + 2, ey + 2, ink)
    g.put(ex + 4, ey + 2, ink)
    g.put(ex + 5, ey + 1, ink)
    g.put(ex + 6, ey + 2, ink)
  } else if (f === 'scared') {
    g.rect(ex, ey, 2, 3, ink)
    g.rect(ex + 4, ey, 2, 3, ink)
    g.put(ex + 1, ey + 1, 'V')
    g.put(ex + 5, ey + 1, 'V')
  } else if (f === 'smug') {
    g.rect(ex, ey + 1, 2, 1, ink)
    g.rect(ex + 4, ey + 1, 2, 2, ink)
  } else {
    g.rect(ex, ey, 2, 2, ink)
    g.rect(ex + 4, ey, 2, 2, ink)
  }
  // boca
  if (f === 'hurt' || f === 'scared') g.rect(ex + 2, ey + 4, 2, 2, ink)
  else if (f === 'win') g.stamp(ex - 1, ey + 3, ['a....a', '.aaaa.'])
  else if (f === 'effort') g.rect(ex + 1, ey + 4, 4, 1, ink)
  else if (f !== 'sleepy') g.stamp(ex, ey + 3, ['a....a', '.aaaa.'])
  // chiado: alguns pontos aleatórios por quadro
  if (p.ov === 'chiado') {
    for (let j = 0; j < 11; j++)
      for (let i = 0; i < 12; i++) {
        const h = (i * 7 + j * 13 + (p.t + 1) * 5 + (i * j) % 5) % 5
        if (h === 0) g.put(x + i, y + j, 'p')
        else if (h === 1) g.put(x + i, y + j, 'D')
      }
  }
  // reflexo no canto
  g.put(x + 1, y + 1, 'a')
  g.put(x + 2, y + 1, 'a')
}

export const teveRig: Rig = {
  id: 'teve',
  shoulders(p) {
    const top = TV_Y + p.dy
    const lx = Math.trunc(p.lean / 2)
    return { fx: AX + 9 + lx, fy: top + 8, bx: AX - 9 + lx, by: top + 8 }
  },
  legBack(g, p) {
    const hip = TV_Y + 17 + p.dy
    leg(g, AX - 5, hip, AX - 5 + p.legs.b[0], FEET - p.legs.b[1], 2, 'E', 'k', 2)
  },
  legFront(g, p) {
    const hip = TV_Y + 17 + p.dy
    leg(g, AX + 3, hip, AX + 3 + p.legs.f[0], FEET - p.legs.f[1], 2, 'E', 'k', 2)
  },
  body(g, p) {
    const top = TV_Y + p.dy
    const lx = Math.trunc(p.lean / 2)
    const bx = AX - 9 + lx
    const W = 19
    const H = 17
    // gabinete de madeira com quinas cortadas
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const corner = (i === 0 || i === W - 1) && (j === 0 || j === H - 1)
        if (corner) continue
        let ch = 'M'
        if (j === 0) ch = 'N'
        else if (j >= H - 2) ch = 'm'
        else if (i === 0) ch = 'N'
        else if (i >= W - 2) ch = 'm'
        else if ((i + j * 3) % 7 === 0) ch = 'm'
        g.put(bx + i, top + j, ch)
      }
    // moldura e vidro
    g.rect(bx + 1, top + 1, 14, 13, 'k')
    tvScreen(g, bx + 2, top + 2, p)
    // painel de botões: dois botões e alto-falante
    g.rect(bx + 16, top + 3, 2, 2, 'y')
    g.rect(bx + 16, top + 6, 2, 2, 'Y')
    g.rect(bx + 16, top + 9, 2, 1, 'k')
    g.rect(bx + 16, top + 11, 2, 1, 'k')
    // antena (as hastes aparecem acima do gabinete)
    const sway = Math.max(-2, Math.min(2, p.pomp))
    g.line(bx + 8, top - 1, bx + 4 + sway, top - 8, 'I')
    g.line(bx + 10, top - 1, bx + 15 + sway, top - 7, 'I')
    g.put(bx + 4 + sway, top - 9, 'p')
    g.put(bx + 15 + sway, top - 8, 'p')
    g.rect(bx + 7, top - 1, 5, 1, 'D')
    g.rect(bx + 8, top - 2, 3, 1, 'D')
  },
  arm(g, sx, sy, hx, hy, front) {
    g.line(sx, sy, hx, hy, front ? 'D' : 'E')
    g.line(sx, sy + 1, hx, hy + 1, front ? 'E' : 'e')
    hand(g, hx, hy, front ? 'I' : 'i')
  }
}

export const RIGS: Record<CharacterId, Rig> = { jan: janRig, janja: janjaRig, xicara: xicaraRig, teve: teveRig }

/** desenha uma pose completa (sem contorno) */
export function composeBody(rig: Rig, p: Pose, held: Held): G {
  const g = new G()
  const sh = rig.shoulders(p)
  const fhx = sh.fx + p.fh[0]
  const fhy = sh.fy + p.fh[1]
  const bhx = sh.bx + p.bh[0]
  const bhy = sh.by + p.bh[1]
  rig.legBack(g, p)
  rig.arm(g, sh.bx, sh.by, bhx, bhy, false)
  rig.body(g, p)
  rig.legFront(g, p)
  rig.arm(g, sh.fx, sh.fy, fhx, fhy, true)
  if (held === 'luvas') {
    drawGlove(g, bhx, bhy, sh.bx, sh.by)
    drawGlove(g, fhx, fhy, sh.fx, sh.fy)
  } else if (held !== 'mao') {
    drawWeapon(g, held, fhx + 0.5, fhy + 0.5, p.ang, p.reach)
  }
  return g
}

export type { Rows }
