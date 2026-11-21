/** "O Telhado": noite de lua sobre a cidade. Mesma técnica da Estante: fundo estático + pedaços animados pequenos. */
import { ARENA_H, ARENA_W, bandedSky, cloudBuf, markPlatform, tOf, type AnimElem, type ArenaArt } from './arenaCommon'
import { ARENA_PLATFORMS } from './geometry'
import { Buf, bayer, hash01 } from './raster'

const MOON = { x: 372, y: 62, r: 22 }

/** prédios do skyline: lista determinística usada pela pintura estática e pelas janelas acesas */
interface Tower {
  x: number
  w: number
  h: number
  depth: 0 | 1
}
function towers(): Tower[] {
  const out: Tower[] = []
  for (const depth of [0, 1] as const) {
    let x = depth ? -6 : -14
    let i = depth * 50
    while (x < ARENA_W) {
      const w = (depth ? 22 : 16) + Math.floor(hash01(i, 5) * (depth ? 22 : 18))
      const h = (depth ? 34 : 52) + Math.floor(hash01(i, 6) * (depth ? 44 : 46))
      out.push({ x, w, h, depth })
      x += w + (depth ? 2 : 1)
      i++
    }
  }
  return out
}
const TOWERS = towers()
const GROUND_Y = 214 // chão da cidade (atrás do prédio do telhado)
/** o prédio vizinho, onde alguém vê TV */
const NEIGH = { x: 428, y: 118, w: 44 }

function farLayer(far: Buf): void {
  bandedSky(far, 0, 0, ARENA_W, 200, 0x070b1a, 0x2e3d66, 11)
  // restante abaixo do céu: fundo escuro da cidade
  far.rect(0, 200, ARENA_W, ARENA_H - 200, 0x0b1022)
  // estrelas estáticas fracas
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(hash01(i, 1) * ARENA_W)
    const y = Math.floor(hash01(i, 2) * 130)
    far.set(x, y, hash01(i, 3) > 0.8 ? 0xb9c4de : 0x5b6c96)
  }
  // lua grande com halo pontilhado e crateras
  for (let y = -50; y <= 50; y++)
    for (let x = -50; x <= 50; x++) {
      const d = Math.sqrt(x * x + y * y)
      if (d > MOON.r && d < 50) {
        const f = (1 - (d - MOON.r) / (50 - MOON.r)) * 0.7
        if (f > bayer(MOON.x + x, MOON.y + y)) far.blend(MOON.x + x, MOON.y + y, 0x9fb4d9, 70)
      }
    }
  far.ellipse(MOON.x, MOON.y, MOON.r, MOON.r, 0xe9eef7)
  for (let y = -MOON.r; y <= MOON.r; y++)
    for (let x = -MOON.r; x <= MOON.r; x++) {
      if (x * x + y * y > MOON.r * MOON.r) continue
      // sombra suave pontilhada do lado direito-baixo (fase)
      const sh = (x + y * 0.4 + MOON.r * 0.4) / (MOON.r * 1.5)
      if (sh > 0.55 && sh - 0.55 > bayer(MOON.x + x, MOON.y + y) * 0.6) far.set(MOON.x + x, MOON.y + y, 0xc3cde3)
    }
  for (const [cx, cy, r] of [[-7, -6, 4], [6, 4, 5], [-4, 9, 3], [9, -8, 2.2], [-12, 3, 2.4]] as const) {
    far.ellipse(MOON.x + cx, MOON.y + cy, r, r, 0xb9c4de)
    far.ellipse(MOON.x + cx - 0.6, MOON.y + cy - 0.6, r * 0.7, r * 0.7, 0xd5ddee)
  }
  // skyline em duas profundidades
  for (const t of TOWERS) {
    const c = t.depth === 0 ? 0x1a2543 : 0x0f1730
    const hi = t.depth === 0 ? 0x2a3a62 : 0x1b2646
    const y = GROUND_Y - t.h
    far.rect(t.x, y, t.w, t.h + 60, c)
    far.hline(t.x, y, t.w, hi)
    far.vline(t.x, y, t.h, hi)
    if (hash01(t.x, t.w, 3) > 0.5) far.rect(t.x + 3, y - 4, 2, 4, c)
    if (hash01(t.x, t.w, 4) > 0.75) {
      far.rect(t.x + Math.floor(t.w / 2) - 1, y - 8, 2, 8, c)
      far.set(t.x + Math.floor(t.w / 2) - 1, y - 8, 0x5b6c96)
    }
    // janelas apagadas
    for (let wy = y + 5; wy < GROUND_Y - 6; wy += 6) for (let wx = t.x + 3; wx < t.x + t.w - 3; wx += 5) far.rect(wx, wy, 2, 3, t.depth === 0 ? 0x121a30 : 0x0a1024)
  }
  // névoa da cidade subindo do chão (pontilhado)
  for (let y = 150; y < 232; y++) for (let x = 0; x < ARENA_W; x++) if ((y - 150) / 82 * 0.5 > bayer(x, y)) far.blend(x, y, 0x34456e, 120)
  // prédio vizinho com a janela da TV
  far.rect(NEIGH.x, NEIGH.y, NEIGH.w + 40, 160, 0x241c24)
  far.hline(NEIGH.x, NEIGH.y, NEIGH.w + 40, 0x3b2f3a)
  far.vline(NEIGH.x, NEIGH.y, 160, 0x3b2f3a)
  for (let wy = NEIGH.y + 10; wy < 190; wy += 14)
    for (let wx = NEIGH.x + 6; wx < NEIGH.x + NEIGH.w + 36; wx += 14) {
      far.rect(wx, wy, 8, 9, 0x15101a)
      far.hline(wx - 1, wy + 9, 10, 0x3b2f3a)
    }
  // caixa de ar condicionado e cano
  far.rect(NEIGH.x + 8, NEIGH.y - 6, 14, 6, 0x3b2f3a)
  far.hline(NEIGH.x + 8, NEIGH.y - 6, 14, 0x5e5048)
}

function windowsElem(): AnimElem {
  return {
    id: 'janelas-cidade',
    layer: 'far',
    w: ARENA_W,
    h: 220,
    key: (t, env) => (env.reduced ? 0 : Math.floor(t / 2200)),
    pos: () => ({ x: 0, y: 0 }),
    paint(b, _t, _e, key) {
      for (const t of TOWERS) {
        const y = GROUND_Y - t.h
        let wi = 0
        for (let wy = y + 5; wy < GROUND_Y - 6; wy += 6)
          for (let wx = t.x + 3; wx < t.x + t.w - 3; wx += 5) {
            wi++
            const base = hash01(t.x, wx, wy)
            const flip = hash01(t.x, wx + key * 3, wy) > 0.93 && base > 0.4
            const on = (base > 0.74) !== flip
            if (on) b.rect(wx, wy, 2, 3, base > 0.9 ? 0xf3ebdd : t.depth ? 0xa97f2a : 0xe0a92e)
          }
        void wi
      }
    }
  }
}

function neighborTv(): AnimElem {
  return {
    id: 'janela-tv',
    layer: 'far',
    w: 12,
    h: 12,
    key: (t, env) => (env.reduced ? 1 : Math.floor(t / 160) % 12),
    pos: () => ({ x: NEIGH.x + 6 + 14 * 2 - 2, y: NEIGH.y + 10 + 14 * 2 - 1 }),
    paint(b, _t, _e, key) {
      const blue = [0x7fb7e6, 0x5b9bd0, 0xbfe3f5, 0x4f8fc4][Math.floor(key / 3) % 4]!
      b.rect(1, 1, 8, 9, 0x241c24)
      b.rect(2, 2, 6, 6, blue)
      b.dither(2, 2, 6, 6, blue, 0xe7f4fb, key % 3 === 0 ? 0.3 : 0.1)
      b.rect(2, 8, 6, 1, 0x15101a)
      b.set(3, 8, 0x0f0b09)
      // brilho que escorre para fora (pontilhado)
      for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (b.alpha(x, y) === 0 && (x + y) % 2 === 0 && x < 10 && y < 11) b.blend(x, y, blue, 28)
    }
  }
}

function starsTwinkle(): AnimElem {
  return {
    id: 'estrelas',
    layer: 'far',
    w: ARENA_W,
    h: 140,
    key: (t, env) => (env.reduced ? 0 : Math.floor(t / 450) % 8),
    pos: () => ({ x: 0, y: 0 }),
    paint(b, _t, _e, key) {
      for (let i = 0; i < 36; i++) {
        const x = 4 + Math.floor(hash01(i, 11) * (ARENA_W - 8))
        const y = 4 + Math.floor(hash01(i, 12) * 120)
        const ph = (key + Math.floor(hash01(i, 13) * 8)) % 8
        if (ph < 2) {
          b.set(x, y, 0xf3ebdd)
          b.set(x - 1, y, 0x9fb4d9)
          b.set(x + 1, y, 0x9fb4d9)
          b.set(x, y - 1, 0x9fb4d9)
          b.set(x, y + 1, 0x9fb4d9)
        } else if (ph < 6) b.set(x, y, 0xdfe6f3)
      }
    }
  }
}

function shootingStar(): AnimElem {
  return {
    id: 'estrela-cadente',
    layer: 'far',
    w: 44,
    h: 22,
    key: (t) => Math.floor(((t / 1000) % 38) * 12),
    pos: (t, env) => {
      if (env.reduced) return null
      const c = (t / 1000) % 38
      if (c < 30 || c > 30.8) return null
      const f = (c - 30) / 0.8
      return { x: 60 + Math.round(f * 130), y: 14 + Math.round(f * 28) }
    },
    paint(b) {
      for (let i = 0; i < 18; i++) b.set(30 - i, 14 - Math.round(i * 0.4), i < 3 ? 0xffffff : i < 8 ? 0xe9eef7 : 0x7e8db2)
      b.set(31, 14, 0xffe9a6)
    }
  }
}

function cloudLayer(id: string, y: number, w: number, h: number, speed: number, seed: number, off: number, c: [number, number, number]): AnimElem {
  const buf = cloudBuf(w, h, seed, c[0], c[1], c[2])
  return {
    id,
    layer: 'far',
    w,
    h,
    key: () => 0,
    pos: (t, env) => {
      const span = ARENA_W + w * 2
      const x = (((tOf(t, env) / 1000) * speed + off) % span) - w
      return { x: Math.round(x), y }
    },
    paint: (b) => b.blit(buf, 0, 0)
  }
}

function bat(): AnimElem {
  return {
    id: 'morcego',
    layer: 'far',
    w: 12,
    h: 8,
    key: (t) => Math.floor(t / 110) % 2,
    pos: (t, env) => {
      if (env.reduced) return null
      const c = (t / 1000) % 27
      if (c > 7) return null
      return { x: ARENA_W + 10 - Math.round(c * 72), y: 40 + Math.round(Math.sin(c * 2.4) * 8) + Math.round(c * 3) }
    },
    paint(b, _t, _e, key) {
      const c = 0x0a0f22
      b.rect(5, 3, 2, 3, c)
      b.set(5, 2, c)
      b.set(6, 2, c)
      if (key) {
        b.line(4, 3, 0, 1, c)
        b.line(7, 3, 11, 1, c)
        b.set(1, 2, c)
        b.set(10, 2, c)
      } else {
        b.line(4, 4, 0, 6, c)
        b.line(7, 4, 11, 6, c)
        b.set(1, 5, c)
        b.set(10, 5, c)
      }
    }
  }
}

// ======================================================================= cenário principal

function roof(b: Buf, mask: Uint8Array): void {
  const x0 = 64
  const x1 = 416
  const y0 = 196
  // fachada do prédio embaixo do telhado
  b.rect(x0 + 6, 246, x1 - x0 - 12, ARENA_H - 246, 0x2b2220)
  for (let y = 246; y < ARENA_H; y += 4)
    for (let x = x0 + 6; x < x1 - 6; x++) {
      const off = ((y - 246) / 4) % 2 ? 4 : 0
      if ((x + off) % 9 === 0) b.set(x, y, 0x1c1614)
      if ((y - 246) % 4 === 3) b.set(x, y, 0x1c1614)
    }
  // janelas do prédio (apagadas, com cortina)
  for (const wx of [110, 210, 310]) {
    b.rect(wx, 252, 26, 18, 0x15101a)
    b.rect(wx + 1, 253, 24, 16, 0x1d2744)
    b.vline(wx + 13, 253, 16, 0x15101a)
    b.rect(wx - 2, 270 - 2, 30, 2, 0x4a3e37)
  }
  // sombra do beiral na fachada
  b.ditherA(x0 + 6, 246, x1 - x0 - 12, 12, 0x0f0b09, 1, 200)
  // o telhado: fileiras de telhas em escamas
  b.rect(x0, y0, x1 - x0, 50, 0xa6482b)
  for (let j = 0; j < 50; j++) {
    const row = Math.floor(j / 5)
    const off = row % 2 ? 6 : 0
    for (let i = 0; i < x1 - x0; i++) {
      const lx = (i + off) % 12
      const ly = j % 5
      let c = 0xb85c3a
      if (ly === 0) c = 0xd2764d
      else if (ly === 4) c = 0x7a3320
      else if (lx === 0) c = 0x7a3320
      else if (ly === 3 && lx > 2 && lx < 10) c = 0xa6482b
      if (hash01(i, j) > 0.992) c = 0x8b3b22
      b.set(x0 + i, y0 + j, c)
    }
  }
  // sombra ao longo da base do telhado (sobe para o pontilhado)
  b.ditherA(x0, y0 + 36, x1 - x0, 14, 0x0f0b09, 0.6, 170)
  // luz da lua no alto (pontilhado)
  for (let j = 0; j < 14; j++) for (let i = 0; i < x1 - x0; i++) if ((1 - j / 14) * 0.45 > bayer(i, j) && Math.abs(x0 + i - 340) < 150) b.blend(x0 + i, y0 + j, 0xbfd0f0, 60)
  // cumeeira / borda de cima mais clara
  b.rect(x0 - 2, y0 - 1, x1 - x0 + 4, 3, 0xe08a55)
  b.hline(x0 - 2, y0 - 1, x1 - x0 + 4, 0xf3b284)
  b.hline(x0 - 2, y0 + 2, x1 - x0 + 4, 0x7a3320)
  // beiral na frente
  b.rect(x0 - 4, 240, x1 - x0 + 8, 8, 0x3b2615)
  b.hline(x0 - 4, 240, x1 - x0 + 8, 0x6b4428)
  b.hline(x0 - 4, 247, x1 - x0 + 8, 0x1c120a)
  for (let x = x0 - 4; x < x1 + 4; x += 6) b.rect(x, 243, 3, 2, 0x2b1b0f)
  // musgo em manchas nas telhas e no alto
  for (let k = 0; k < 18; k++) {
    const cx = x0 + 10 + Math.floor(hash01(k, 21) * (x1 - x0 - 20))
    const cy = y0 + 2 + Math.floor(hash01(k, 22) * 36)
    const r = 3 + Math.floor(hash01(k, 23) * 5)
    for (let y = -r; y <= r; y++)
      for (let x = -r * 2; x <= r * 2; x++) {
        const d = Math.sqrt((x / 2) ** 2 + y * y) / r
        if (d < 1 && (1 - d) * 1.3 > bayer(cx + x, cy + y) && b.get(cx + x, cy + y) !== 0) b.set(cx + x, cy + y, hash01(cx + x, cy + y) > 0.6 ? 0x6b8f4d : 0x4d7f4a)
      }
  }
  // calha e pingos
  b.hline(x0 - 4, 239, x1 - x0 + 8, 0x948779)
  markPlatform(mask, x0, y0, x1 - x0, 50)
}

function chimney(b: Buf, mask: Uint8Array): void {
  const { x, y, w, h } = ARENA_PLATFORMS.telhado[3]!
  b.rect(x, y, w, h, 0x8a3b28)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const row = Math.floor(j / 4)
      const off = row % 2 ? 5 : 0
      let c = 0x9c4630
      if (j % 4 === 3) c = 0x5a2518
      else if ((i + off) % 10 === 0) c = 0x5a2518
      else if (j % 4 === 0) c = 0xb85c3a
      b.set(x + i, y + j, c)
    }
  b.vline(x + w - 1, y, h, 0x4a1d12)
  b.vline(x + w - 2, y, h, 0x6a2c1c)
  // laje do topo e boca escura
  b.rect(x, y, w, 4, 0xb7a99a)
  b.hline(x, y, w, 0xe7dcc8)
  b.hline(x, y + 3, w, 0x7a6c60)
  b.rect(x + 5, y + 1, w - 10, 2, 0x221c19)
  b.ditherA(x, y + 4, w, 8, 0x0f0b09, 0.5, 140)
  markPlatform(mask, x, y, w, h)
}

function waterTank(b: Buf, mask: Uint8Array): void {
  const { x, y, w } = ARENA_PLATFORMS.telhado[1]!
  // pernas de ferro e travessas
  for (const lx of [x + 6, x + 22, x + w - 26, x + w - 10]) {
    b.rect(lx, y + 40, 4, 196 - (y + 40), 0x3b312c)
    b.vline(lx, y + 40, 196 - (y + 40), 0x5e5048)
  }
  for (let k = 0; k < 2; k++) {
    b.line(x + 8, y + 50 + k * 8, x + w - 8, y + 70 + k * 8, 0x4a3e37)
    b.line(x + w - 8, y + 50 + k * 8, x + 8, y + 70 + k * 8, 0x4a3e37)
  }
  b.rect(x + 2, y + 62, w - 4, 3, 0x3b312c)
  // sombra no telhado
  b.ditherA(x, 190, w, 8, 0x0f0b09, 0.9, 150)
  // corpo cilíndrico
  b.rect(x + 2, y + 6, w - 4, 34, 0x5b7c99)
  for (let j = 0; j < 34; j++)
    for (let i = 0; i < w - 4; i++) {
      const f = i / (w - 4)
      let c = 0x5b7c99
      if (f < 0.12) c = 0x7aa0bf
      else if (f > 0.85) c = 0x3f5a73
      else if (f > 0.7) c = 0x4d6b87
      if (j % 11 === 10) c = 0x3f5a73
      if ((i * 7 + j * 3) % 31 === 0) c = 0x6d8fae
      b.set(x + 2 + i, y + 6 + j, c)
    }
  for (let i = 4; i < w - 4; i += 10) {
    b.set(x + 2 + i, y + 10, 0x9fb4d9)
    b.set(x + 2 + i, y + 33, 0x9fb4d9)
  }
  b.ditherA(x + 2, y + 6, w - 4, 34, 0x0f0b09, 0.15, 110)
  // tampa: fina (é a plataforma)
  b.rect(x, y, w, 6, 0x948779)
  b.hline(x, y, w, 0xe7dcc8)
  b.hline(x, y + 1, w, 0xb7a99a)
  b.hline(x, y + 5, w, 0x4a3e37)
  for (let i = 5; i < w; i += 11) b.set(x + i, y + 3, 0x5e5048)
  b.rect(x + w - 22, y - 3, 12, 3, 0x7a6c60)
  b.hline(x + w - 22, y - 3, 12, 0xb7a99a)
  // escadinha de ferro
  const lx = x + w + 6
  b.vline(lx, y + 4, 196 - y - 4, 0x7a6c60)
  b.vline(lx + 8, y + 4, 196 - y - 4, 0x7a6c60)
  for (let ry = y + 10; ry < 194; ry += 6) b.hline(lx, ry, 9, 0x948779)
  b.vline(lx + 1, y + 4, 196 - y - 4, 0x3b312c)
  markPlatform(mask, x, y, w, 6)
}

function antenna(b: Buf, mask: Uint8Array): void {
  const { x, y, w } = ARENA_PLATFORMS.telhado[2]!
  const mx = x + Math.floor(w / 2)
  // mastro até o telhado
  b.rect(mx - 1, y, 3, 196 - y, 0x7a6c60)
  b.vline(mx - 1, y, 196 - y, 0xb7a99a)
  b.vline(mx + 1, y, 196 - y, 0x3b312c)
  b.ditherA(mx - 6, 190, 14, 6, 0x0f0b09, 0.9, 140)
  // estais
  b.line(mx, y + 6, x - 4, 194, 0x4a3e37)
  b.line(mx, y + 6, x + w + 4, 194, 0x4a3e37)
  // barras do conjunto de antena acima
  const rods: [number, number][] = [[y - 20, 40], [y - 14, 34], [y - 8, 28], [y - 2, 22]]
  b.rect(mx - 1, y - 26, 3, 26, 0x948779)
  for (const [ry, rw] of rods) {
    b.rect(mx - rw / 2, ry, rw, 2, 0xb7a99a)
    b.hline(mx - rw / 2, ry, rw, 0xe7dcc8)
    b.set(mx - rw / 2, ry, 0xe7dcc8)
  }
  // plataforma fina: escada deitada / prancha de manutenção
  b.rect(x, y, w, 6, 0x6b4428)
  b.hline(x, y, w, 0xb98550)
  b.hline(x, y + 1, w, 0x8a5a34)
  b.hline(x, y + 5, w, 0x3b2615)
  for (let i = 0; i < w; i += 8) b.vline(x + i, y, 6, 0x4a2e1b)
  b.rect(x + 2, y + 6, 3, 3, 0x3b312c)
  b.rect(x + w - 5, y + 6, 3, 3, 0x3b312c)
  markPlatform(mask, x, y, w, 6)
  void mx
}

function railing(b: Buf): void {
  // murinho baixo nas pontas do telhado
  for (const sx of [64, 408]) {
    b.rect(sx, 186, 8, 12, 0x5e5048)
    b.hline(sx, 186, 8, 0x948779)
    b.rect(sx + 1, 188, 6, 8, 0x4a3e37)
  }
}

// ======================================================================= animados

function steamChimney(): AnimElem {
  return {
    id: 'fumaca',
    layer: 'back',
    w: 40,
    h: 70,
    key: (t, env) => (env.reduced ? 0 : Math.floor(t / 140) % 64),
    pos: () => ({ x: 344, y: 98 }),
    paint(b, _t, _e, key) {
      for (let i = 0; i < 9; i++) {
        const age = ((key + i * 7) % 64) / 64
        const y = 66 - age * 66
        const x = 18 + age * 10 + Math.sin(age * 9 + i) * 3
        const r = 2 + age * 5
        const f = 1 - age
        for (let yy = -Math.ceil(r); yy <= Math.ceil(r); yy++)
          for (let xx = -Math.ceil(r); xx <= Math.ceil(r); xx++)
            if (xx * xx + yy * yy <= r * r && f * 0.9 > bayer(Math.round(x) + xx, Math.round(y) + yy)) b.blend(Math.round(x) + xx, Math.round(y) + yy, age < 0.3 ? 0xd9ccb8 : 0xb7a99a, 120)
      }
    }
  }
}

function antennaLight(): AnimElem {
  return {
    id: 'luz-antena',
    layer: 'back',
    w: 11,
    h: 11,
    key: (t, env) => (env.reduced ? 1 : Math.floor(t / 600) % 3 === 0 ? 0 : 1),
    pos: () => ({ x: 92 + 26 - 5, y: 150 - 31 }),
    paint(b, _t, _e, key) {
      b.rect(4, 5, 3, 3, 0x6e2a24)
      if (key === 1) {
        b.rect(4, 5, 3, 3, 0xff4a3a)
        b.set(5, 6, 0xffd0c8)
        for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) if ((x + y) % 2 === 0 && Math.hypot(x - 5, y - 6) < 5 && b.alpha(x, y) === 0) b.blend(x, y, 0xff4a3a, 70)
      }
    }
  }
}

function clothesline(): AnimElem {
  const W = 84
  const H = 40
  return {
    id: 'varal',
    layer: 'back',
    w: W,
    h: H,
    key: (t, env) => {
      const react = !env.reduced && env.koAge < 1800 ? 1 + Math.floor(env.koAge / 150) % 2 : 0
      return react * 100 + (env.reduced ? 0 : Math.floor(t / 300) % 12)
    },
    pos: () => ({ x: 120, y: 158 }),
    paint(b, _t, _e, key) {
      const react = Math.floor(key / 100)
      const ph = ((key % 100) / 12) * Math.PI * 2
      const amp = react ? 4 : 1.2
      // fio com barriga
      for (let x = 0; x < W; x++) b.set(x, Math.round(2 + Math.sin((x / W) * Math.PI) * 4), 0xb7a99a)
      const items: { x: number; w: number; h: number; c: number; c2: number; kind: number }[] = [
        { x: 8, w: 12, h: 14, c: 0xff7a6b, c2: 0xd9594b, kind: 0 },
        { x: 26, w: 4, h: 7, c: 0xf3ebdd, c2: 0xd9ccb8, kind: 1 },
        { x: 34, w: 4, h: 7, c: 0xffc94a, c2: 0xe0a92e, kind: 1 },
        { x: 44, w: 14, h: 18, c: 0x7fb7e6, c2: 0x4f8fc4, kind: 2 },
        { x: 64, w: 11, h: 10, c: 0xf3ebdd, c2: 0xd9ccb8, kind: 3 }
      ]
      for (const it of items) {
        const sy = 2 + Math.round(Math.sin((it.x / W) * Math.PI) * 4)
        for (let j = 0; j < it.h; j++) {
          const sway = Math.round(Math.sin(ph + it.x * 0.2 + j * 0.15) * amp * (j / it.h))
          const hw = it.kind === 0 ? it.w - (j < 4 ? 4 : 0) : it.w
          const x0 = it.x + sway + (it.kind === 0 && j < 4 ? 2 : 0)
          for (let i = 0; i < hw; i++) {
            let c = i > hw - 3 ? it.c2 : it.c
            if (it.kind === 2 && j > 7 && i === Math.floor(hw / 2)) c = 0
            if (c) b.set(x0 + i, sy + 1 + j, c)
          }
          if (it.kind === 3 && j % 3 === 2) b.hline(x0, sy + 1 + j, it.w, it.c2)
        }
        b.set(it.x + Math.floor(it.w / 3), sy, 0xff7a6b)
        b.set(it.x + Math.floor((it.w * 2) / 3), sy, 0xff7a6b)
      }
    }
  }
}

function cat(): AnimElem {
  return {
    id: 'gato-beiral',
    layer: 'back',
    w: 22,
    h: 20,
    key: (t, env) => {
      const scared = !env.reduced && env.koAge < 1500 ? 1 : 0
      const tail = env.reduced ? 0 : Math.floor(t / 400) % 4
      const ear = !env.reduced && Math.floor(t / 100) % 37 < 2 ? 1 : 0
      return scared * 100 + tail * 10 + ear
    },
    pos: () => ({ x: 72, y: 179 }),
    paint(b, _t, _e, key) {
      const scared = key >= 100
      const tail = Math.floor((key % 100) / 10)
      const ear = key % 10
      const fur = 0x2b2a35
      const hi = 0x4a4a5c
      // corpo sentado de costas para a lua, silhueta escura
      b.ellipse(9, 14, 6.5, 6, fur)
      b.rect(3, 15, 13, 4, fur)
      b.ellipse(11, 7, 4.6, 4.2, fur)
      const ey = scared ? 1 : 0
      b.set(8, 1 - ey + ear, fur)
      b.set(9, 2 - ey, fur)
      b.set(13, 1 - ey, fur)
      b.set(14, 2 - ey, fur)
      b.set(12, 3 - ey, fur)
      b.vline(5, 10, 6, hi)
      // olhos amarelos
      b.set(9, 7, 0xffc94a)
      b.set(13, 7, 0xffc94a)
      if (scared) {
        b.rect(9, 6, 1, 3, 0xffe9a6)
        b.rect(13, 6, 1, 3, 0xffe9a6)
        for (let i = 0; i < 5; i++) b.set(4 + i * 3, 9 - (i % 2), fur)
      }
      // rabo
      const sw = [0, 1, 2, 1][tail]!
      for (let k = 0; k < 9; k++) b.set(16 + Math.round(k * 0.6), 18 - Math.round(Math.sin((k / 9) * 2 + sw * 0.4) * 2) - (scared ? k : 0), fur)
    }
  }
}

function fireflies(): AnimElem {
  return {
    id: 'vagalumes',
    layer: 'front',
    w: ARENA_W,
    h: 200,
    key: (t, env) => (env.reduced ? 0 : Math.floor(t / 220)),
    pos: () => ({ x: 0, y: 70 }),
    paint(b, _t, _e, key) {
      for (let i = 0; i < 9; i++) {
        const tt = key * 0.22
        const x = Math.round(30 + hash01(i, 1) * 420 + Math.sin(tt * 0.4 + i) * 14)
        const y = Math.round(90 + hash01(i, 2) * 100 + Math.cos(tt * 0.5 + i * 2) * 8)
        const on = Math.sin(tt * 1.7 + i * 1.9) > 0.2
        if (!on) continue
        b.set(x, y, 0xfff6a0)
        b.blend(x - 1, y, 0xc9d86b, 90)
        b.blend(x + 1, y, 0xc9d86b, 90)
        b.blend(x, y - 1, 0xc9d86b, 90)
        b.blend(x, y + 1, 0xc9d86b, 90)
      }
    }
  }
}

export function buildTelhado(): ArenaArt {
  const far = new Buf(ARENA_W, ARENA_H)
  const back = new Buf(ARENA_W, ARENA_H)
  const front = new Buf(ARENA_W, ARENA_H)
  const mask = new Uint8Array(ARENA_W * ARENA_H)
  farLayer(far)
  roof(back, mask)
  waterTank(back, mask)
  antenna(back, mask)
  railing(back)
  chimney(back, mask)
  // vinheta pontilhada nas bordas da frente
  for (let y = 0; y < ARENA_H; y++)
    for (let x = 0; x < ARENA_W; x++) {
      const e = Math.max(0, Math.abs(x - 240) / 240 - 0.7) * 1.8 + Math.max(0, y / ARENA_H - 0.9) * 2
      if (e > bayer(x, y)) front.blend(x, y, 0x070b1a, 170)
    }
  const anims: AnimElem[] = [
    starsTwinkle(),
    shootingStar(),
    cloudLayer('nuvem-longe', 34, 70, 18, 2.2, 5, 40, [0x1e2a4a, 0x151e38, 0x34456e]),
    cloudLayer('nuvem-perto', 96, 90, 22, 5.5, 9, 260, [0x2c3a5e, 0x1e2a4a, 0x4a5d8a]),
    windowsElem(),
    neighborTv(),
    bat(),
    steamChimney(),
    antennaLight(),
    clothesline(),
    cat(),
    fireflies()
  ]
  return { id: 'telhado', far, back, front, anims, platformMask: mask, wall: 0x070b1a }
}
