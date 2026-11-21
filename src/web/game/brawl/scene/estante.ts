/** "A Estante": sala de estar à noite. Tudo pintado por código, em 480x270, com pontilhado no lugar de degradê. */
import { ARENA_H, ARENA_W, bandedSky, bookRow, cloudBuf, markPlatform, tOf, type AnimElem, type ArenaArt, type Env } from './arenaCommon'
import { ARENA_PLATFORMS } from './geometry'
import { Buf, bayer, hash01, hash2, mix } from './raster'

const GL = { x: 20, y: 30, w: 66, h: 110 } // vidro da janela

const WOOD = { hi: 0xd8a76a, light: 0xb98550, mid: 0x8a5a34, dark: 0x6b4428, deep: 0x4a2e1b, black: 0x2f1d12 }

function wallpaper(b: Buf): void {
  const base = 0x2e2622
  for (let y = 0; y < 234; y++)
    for (let x = 0; x < ARENA_W; x++) {
      let c = base
      const d1 = (x + y) % 20
      const d2 = (x - y + 400) % 20
      if (d1 === 0 || d2 === 0) c = 0x352b26
      if (d1 === 0 && d2 === 0) c = 0x42352d
      // florzinha no centro de cada losango
      if ((x - 10) % 20 === 0 && (y - 0) % 20 === 10 && x % 2 === 0) c = 0x3f332d
      b.set(x, y, c)
    }
  // sombra do teto e brilho quente do abajur (pontilhado)
  for (let y = 0; y < 234; y++)
    for (let x = 0; x < ARENA_W; x++) {
      const up = Math.max(0, 1 - y / 70) * 0.5
      if (up > bayer(x, y)) b.set(x, y, 0x1a1512)
      const dx = (x - 240) / 170
      const dy = (y - 80) / 110
      const w = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy)) * 0.55
      if (w > bayer(x + 1, y + 2)) b.blend(x, y, 0xffc94a, 34)
    }
  // cantos escuros (vinheta pontilhada)
  for (let y = 0; y < 234; y++)
    for (let x = 0; x < ARENA_W; x++) {
      const e = Math.max(0, Math.abs(x - 240) / 240 - 0.62) * 1.6
      if (e > bayer(x + 3, y + 1)) b.set(x, y, mix(b.get(x, y), 0x0f0b09, 0.55))
    }
  // moldura do teto
  b.rect(0, 0, ARENA_W, 8, 0x1a1512)
  b.hline(0, 8, ARENA_W, 0x3b312c)
  b.hline(0, 9, ARENA_W, 0x5e5048)
  b.hline(0, 10, ARENA_W, 0x221c19)
  for (let x = 0; x < ARENA_W; x += 6) b.rect(x, 3, 3, 2, 0x2e2622)
  // rodapé
  b.rect(0, 224, ARENA_W, 10, 0x3b312c)
  b.hline(0, 224, ARENA_W, 0x5e5048)
  b.hline(0, 225, ARENA_W, 0x4a3e37)
  b.hline(0, 233, ARENA_W, 0x1a1512)
}

function floor(b: Buf): void {
  for (let y = 234; y < ARENA_H; y++) {
    const row = Math.floor((y - 234) / 6)
    for (let x = 0; x < ARENA_W; x++) {
      const seam = (x + row * 37) % 64 === 0
      let c = row % 2 ? 0x41352e : 0x4a3e37
      if (seam || (y - 234) % 6 === 5) c = 0x2e2622
      else if ((y - 234) % 6 === 0) c = mix(c, 0x7a6c60, 0.25)
      if (hash01(x, y) > 0.985) c = mix(c, 0x2e2622, 0.5)
      b.set(x, y, c)
    }
  }
  // sombra do rodapé
  for (let y = 234; y < 246; y++) for (let x = 0; x < ARENA_W; x++) if (1 - (y - 234) / 12 > bayer(x, y)) b.blend(x, y, 0x0f0b09, 150)
  // tapete embaixo do móvel
  const rx = 112
  const ry = 240
  const rw = 256
  const rh = 26
  b.rect(rx, ry, rw, rh, 0x6e2a24)
  b.rect(rx, ry, rw, 1, 0xa8392f)
  b.rect(rx, ry + rh - 1, rw, 1, 0x4a1a16)
  for (let x = rx + 4; x < rx + rw - 4; x += 8) {
    b.rect(x, ry + 5, 4, rh - 10, 0x7e342c)
    b.rect(x + 1, ry + 11, 2, 4, 0xffc94a)
  }
  b.rect(rx + 3, ry + 3, rw - 6, 1, 0xd9594b)
  b.rect(rx + 3, ry + rh - 4, rw - 6, 1, 0xd9594b)
  for (let x = rx - 3; x < rx + rw + 3; x += 2) {
    b.rect(x, ry - 2, 1, 2, 0xd9ccb8)
    b.rect(x, ry + rh, 1, 2, 0xd9ccb8)
  }
  b.ditherA(rx, ry + rh, rw, 6, 0x0f0b09, 0.7, 180)
}

function windowFrame(back: Buf, far: Buf, mask: Uint8Array): void {
  // céu e cidade (distante)
  bandedSky(far, GL.x, GL.y, GL.w, GL.h, 0x0e1428, 0x34456e, 7)
  // estrelas
  for (let i = 0; i < 14; i++) {
    const x = GL.x + 2 + Math.floor(hash01(i, 1) * (GL.w - 4))
    const y = GL.y + 2 + Math.floor(hash01(i, 2) * 52)
    far.set(x, y, i % 3 ? 0x9fb4d9 : 0xf3ebdd)
  }
  // lua com halo
  const mx = GL.x + 46
  const my = GL.y + 24
  for (let y = -16; y <= 16; y++)
    for (let x = -16; x <= 16; x++) {
      const d = Math.sqrt(x * x + y * y)
      if (d > 7.5 && d < 16 && (1 - d / 16) * 0.5 > bayer(mx + x, my + y)) far.blend(mx + x, my + y, 0x9fb4d9, 90)
    }
  far.ellipse(mx, my, 7, 7, 0xe9eef7)
  far.ellipse(mx + 2, my + 1, 5, 5.5, 0xd1d9ea)
  far.ellipse(mx - 2, my - 2, 1.6, 1.4, 0xb9c4de)
  far.ellipse(mx + 2, my + 3, 1.3, 1.2, 0xb9c4de)
  // prédios (duas profundidades)
  const gx = GL.x
  const gy = GL.y
  let x = 0
  let i = 0
  while (x < GL.w) {
    const w = 8 + Math.floor(hash01(i, 5) * 9)
    const h = 22 + Math.floor(hash01(i, 6) * 26)
    far.rect(gx + x, gy + GL.h - h, w, h, 0x1d2744)
    far.hline(gx + x, gy + GL.h - h, w, 0x2b3a60)
    x += w + 1
    i++
  }
  x = -4
  i = 20
  while (x < GL.w) {
    const w = 10 + Math.floor(hash01(i, 5) * 12)
    const h = 12 + Math.floor(hash01(i, 6) * 22)
    far.rect(gx + x, gy + GL.h - h, w, h, 0x121a30)
    far.hline(gx + x, gy + GL.h - h, w, 0x1d2744)
    if (hash01(i, 9) > 0.6) far.rect(gx + x + Math.floor(w / 2), gy + GL.h - h - 4, 1, 4, 0x121a30)
    x += w + 1
    i++
  }
  // moldura de madeira da janela (por cima, com buraco no vidro)
  const fx = 14
  const fy = 24
  const fw = 78
  const fh = 128
  back.rect(fx, fy, fw, fh, WOOD.dark)
  back.rect(fx, fy, fw, 1, WOOD.light)
  back.vline(fx, fy, fh, WOOD.mid)
  back.vline(fx + fw - 1, fy, fh, WOOD.deep)
  back.rect(fx + 3, fy + 3, fw - 6, fh - 6, WOOD.mid)
  back.hole(GL.x, GL.y, GL.w, GL.h)
  // reflexo no vidro (pontilhado leve, também no buraco: pinta por cima com alfa)
  for (let j = 0; j < GL.h; j++)
    for (let k = 0; k < GL.w; k++) {
      const d = (k + j * 0.6) % 24
      if (d < 3 && bayer(k, j) < 0.35) back.blend(GL.x + k, GL.y + j, 0xf3ebdd, 26)
    }
  // travessas
  back.rect(GL.x + 32, GL.y, 3, GL.h, WOOD.dark)
  back.vline(GL.x + 32, GL.y, GL.h, WOOD.light)
  back.rect(GL.x, GL.y + 52, GL.w, 3, WOOD.dark)
  back.hline(GL.x, GL.y + 52, GL.w, WOOD.light)
  // peitoril
  back.rect(10, 150, 86, 6, WOOD.light)
  back.hline(10, 150, 86, WOOD.hi)
  back.hline(10, 155, 86, WOOD.deep)
  back.ditherA(10, 156, 86, 6, 0x0f0b09, 0.6, 160)
  // trilho da cortina
  back.rect(4, 14, 98, 2, 0xb7a99a)
  back.hline(4, 14, 98, 0xf3ebdd)
  back.rect(2, 12, 4, 6, 0xffc94a)
  back.rect(100, 12, 4, 6, 0xffc94a)
  void mask
}

function bookcase(b: Buf): void {
  const x0 = 96
  const x1 = 384
  // fundo de madeira escura com veios
  for (let y = 54; y < 188; y++)
    for (let x = x0 + 8; x < x1 - 8; x++) {
      let c = 0x33231a
      if ((x * 3 + Math.floor(y / 9) * 11) % 17 === 0) c = 0x2b1c14
      if ((x + Math.floor(y / 5) * 5) % 29 === 0) c = 0x3b2a1f
      b.set(x, y, c)
    }
  // sombra superior e lateral (pontilhado)
  for (let y = 54; y < 188; y++)
    for (let x = x0 + 8; x < x1 - 8; x++) {
      const t = Math.max(1 - (y - 54) / 28, 1 - (x - (x0 + 8)) / 16, 1 - (x1 - 8 - x) / 16)
      if (t > 0 && t * 0.85 > bayer(x, y)) b.blend(x, y, 0x0f0b09, 150)
    }
  // montantes laterais
  for (const px of [x0, x1 - 8]) {
    b.rect(px, 44, 8, 150, WOOD.mid)
    b.vline(px, 44, 150, WOOD.light)
    b.vline(px + 7, 44, 150, WOOD.deep)
    for (let y = 48; y < 190; y += 3) b.set(px + 2 + ((y * 7) % 3), y, WOOD.dark)
  }
  // tampo e cimalha
  b.rect(x0 - 4, 40, x1 - x0 + 8, 6, WOOD.light)
  b.hline(x0 - 4, 40, x1 - x0 + 8, WOOD.hi)
  b.hline(x0 - 4, 45, x1 - x0 + 8, WOOD.deep)
  b.rect(x0, 46, x1 - x0, 6, WOOD.mid)
  for (let x = x0 + 3; x < x1 - 3; x += 8) b.rect(x, 48, 4, 3, WOOD.dark)
  b.ditherA(x0 + 8, 52, x1 - x0 - 16, 6, 0x0f0b09, 0.6, 170)
}

function shelf(b: Buf, mask: Uint8Array, x: number, y: number, w: number): void {
  // sombra projetada no fundo
  b.ditherA(x, y + 6, w, 10, 0x0f0b09, 0.5, 110)
  b.rect(x, y, w, 6, WOOD.light)
  b.hline(x, y, w, WOOD.hi)
  b.hline(x, y + 1, w, 0xcb9560)
  b.hline(x, y + 5, w, WOOD.deep)
  for (let i = 0; i < w; i += 7) b.set(x + i + (i % 3), y + 3, WOOD.mid)
  b.vline(x, y, 6, WOOD.hi)
  b.vline(x + w - 1, y, 6, WOOD.mid)
  // mãos-francesas
  for (const bx of [x + 8, x + w - 14]) for (let k = 0; k < 6; k++) b.rect(bx, y + 6 + k, 6 - k, 1, WOOD.dark)
  markPlatform(mask, x, y, w, 6)
}

function cabinet(b: Buf, mask: Uint8Array): void {
  const x = 96
  const y = 188
  const w = 288
  const h = 46
  b.rect(x, y, w, h, WOOD.mid)
  // tampo
  b.rect(x - 2, y, w + 4, 6, WOOD.light)
  b.hline(x - 2, y, w + 4, WOOD.hi)
  b.hline(x - 2, y + 1, w + 4, 0xcb9560)
  b.hline(x - 2, y + 5, w + 4, WOOD.deep)
  for (let i = 0; i < w; i += 9) b.set(x + i + ((i * 5) % 4), y + 3, WOOD.mid)
  // portas
  const dw = w / 4
  for (let d = 0; d < 4; d++) {
    const dx = x + d * dw
    b.rect(dx + 3, y + 8, dw - 6, 30, WOOD.deep)
    b.rect(dx + 4, y + 9, dw - 8, 28, WOOD.mid)
    // veio da madeira
    for (let k = 0; k < dw - 10; k++) {
      const gx = dx + 5 + k
      for (let j = 0; j < 26; j++) {
        const v = (k * 5 + Math.floor(j / 3) * 7 + d * 13) % 11
        if (v === 0) b.set(gx, y + 10 + j, WOOD.dark)
        else if (v === 5 && j % 4 < 2) b.set(gx, y + 10 + j, 0x9a6a3e)
      }
    }
    // filete interno e luz de cima
    b.rect(dx + 8, y + 13, dw - 16, 22, WOOD.mid)
    b.hline(dx + 8, y + 13, dw - 16, WOOD.dark)
    b.vline(dx + 8, y + 13, 22, WOOD.dark)
    b.hline(dx + 8, y + 34, dw - 16, 0x9a6a3e)
    b.vline(dx + dw - 9, y + 13, 22, 0x9a6a3e)
    for (let k = 0; k < dw - 18; k++) for (let j = 0; j < 20; j++) if ((k * 3 + j * 5 + d * 7) % 13 === 0) b.set(dx + 9 + k, y + 14 + j, 0x7a4c2a)
    // puxador redondo
    const kx = d % 2 === 0 ? dx + dw - 14 : dx + 12
    b.ellipse(kx, y + 24, 3, 3, 0xe0a92e)
    b.ellipse(kx - 0.5, y + 23.5, 1.5, 1.5, 0xffe9a6)
    b.set(kx + 2, y + 26, 0x8b6a1a)
  }
  // rodapé do móvel e pezinhos
  b.rect(x, y + 38, w, 8, WOOD.dark)
  b.hline(x, y + 38, w, WOOD.deep)
  b.hline(x, y + 39, w, 0x7a4c2a)
  b.rect(x, y + 45, w, 1, WOOD.black)
  for (let i = 0; i < 3; i++) b.rect(x + 8 + i * 140, y + 40, 20, 5, WOOD.deep)
  // sombra lateral do móvel
  b.vline(x, y + 6, 40, WOOD.light)
  b.vline(x + w - 1, y + 6, 40, WOOD.deep)
  markPlatform(mask, x, y, w, h)
}

function armchair(b: Buf): void {
  const x = 8
  const y = 172
  const c = { a: 0x6e2a24, b: 0x8a3a30, c: 0xa8392f, d: 0x4a1a16 }
  b.ditherA(x, 230, 90, 6, 0x0f0b09, 1, 180)
  // encosto
  b.rect(x + 6, y, 72, 36, c.a)
  b.ellipse(x + 42, y + 2, 38, 6, c.b)
  b.rect(x + 8, y + 4, 68, 30, c.a)
  for (let j = 0; j < 30; j++) for (let i = 0; i < 68; i++) if ((i + j * 2) % 9 === 0 && bayer(i, j) < 0.5) b.set(x + 8 + i, y + 4 + j, c.b)
  // botões do capitonê
  for (let r = 0; r < 2; r++) for (let k = 0; k < 6; k++) b.set(x + 14 + k * 12, y + 12 + r * 12, c.d)
  // braços
  for (const ax of [x, x + 72]) {
    b.rect(ax, y + 22, 12, 38, c.b)
    b.rect(ax, y + 22, 12, 4, c.c)
    b.vline(ax, y + 26, 34, c.a)
    b.vline(ax + 11, y + 26, 34, c.d)
  }
  // assento
  b.rect(x + 10, y + 36, 64, 12, c.c)
  b.hline(x + 10, y + 36, 64, 0xc8493b)
  b.hline(x + 10, y + 47, 64, c.d)
  b.rect(x + 10, y + 48, 64, 8, c.a)
  // pés
  for (const px of [x + 4, x + 70]) {
    b.rect(px, y + 58, 6, 6, WOOD.dark)
    b.hline(px, y + 63, 6, WOOD.black)
  }
}

function wallClock(b: Buf): void {
  const cx = 440
  const cy = 38
  // caixa longa
  b.rect(430, 50, 20, 40, WOOD.mid)
  b.rect(432, 54, 16, 32, 0x1a1512)
  b.rect(430, 50, 20, 2, WOOD.light)
  b.vline(430, 50, 40, WOOD.light)
  b.vline(449, 50, 40, WOOD.deep)
  b.rect(432, 90, 16, 3, WOOD.deep)
  // mostrador
  b.ellipse(cx, cy, 13, 13, WOOD.deep)
  b.ellipse(cx, cy, 12, 12, WOOD.light)
  b.ellipse(cx, cy, 10, 10, 0xf3ebdd)
  b.ellipse(cx - 1, cy - 2, 5, 3, 0xffffff)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    b.set(cx + Math.round(Math.sin(a) * 8.5), cy - Math.round(Math.cos(a) * 8.5), i % 3 === 0 ? 0x221c19 : 0x8b7e70)
  }
  b.line(cx, cy, cx + 4, cy - 3, 0x221c19)
  b.line(cx, cy, cx - 1, cy - 6, 0x221c19)
  b.set(cx, cy, 0xa8392f)
  // brilho do vidro da caixa
  b.vline(433, 56, 12, 0x3b312c)
}

function aquariumStatic(b: Buf): void {
  const x = 404
  const y = 98
  const w = 68
  const h = 34
  // prateleira de apoio
  b.rect(x - 4, y + h, w + 8, 5, WOOD.light)
  b.hline(x - 4, y + h, w + 8, WOOD.hi)
  b.hline(x - 4, y + h + 4, w + 8, WOOD.deep)
  b.ditherA(x - 4, y + h + 5, w + 8, 8, 0x0f0b09, 0.8, 140)
  // água pontilhada
  b.rect(x, y, w, h, 0x2f6290)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if ((1 - j / h) * 0.5 > bayer(i, j)) b.set(x + i, y + j, 0x4f8fc4)
  b.rect(x, y, w, 3, 0x7fb7e6)
  b.dither(x, y + 3, w, 3, 0x7fb7e6, 0x4f8fc4, 0.5)
  // areia, pedras e plantas
  b.rect(x, y + h - 5, w, 5, 0xc98e66)
  for (let i = 0; i < w; i += 3) b.set(x + i, y + h - 5 + (i % 2), 0xe8b48a)
  b.ellipse(x + 14, y + h - 5, 6, 3, 0x7a6c60)
  b.ellipse(x + 12, y + h - 6, 2.5, 1.5, 0x948779)
  for (const [px, ph] of [
    [x + 52, 14],
    [x + 56, 18],
    [x + 6, 10]
  ] as const)
    for (let k = 0; k < ph; k++) b.set(px + Math.round(Math.sin(k * 0.7) * 1.4), y + h - 6 - k, k % 3 === 0 ? 0x6fd49b : 0x3fa070)
  // castelinho
  b.rect(x + 28, y + h - 12, 9, 8, 0xa9743f)
  b.rect(x + 28, y + h - 14, 2, 2, 0xa9743f)
  b.rect(x + 35, y + h - 14, 2, 2, 0xa9743f)
  b.rect(x + 31, y + h - 9, 3, 5, 0x2f1d12)
  // moldura de vidro
  b.rect(x - 2, y - 2, w + 4, 2, 0x5e5048)
  b.vline(x - 2, y - 2, h + 2, 0x5e5048)
  b.vline(x + w + 1, y - 2, h + 2, 0x5e5048)
  b.vline(x + 3, y + 4, 16, 0xbfe3f5)
  b.set(x + 3, y + 22, 0xbfe3f5)
  // lâmpada do aquário
  b.rect(x + 8, y - 6, 22, 4, 0x3b312c)
  b.rect(x + 10, y - 5, 18, 1, 0x6fd49b)
}

function tvAndRack(b: Buf): void {
  // rack
  const rx = 388
  const ry = 190
  b.rect(rx, ry, 64, 6, WOOD.light)
  b.hline(rx, ry, 64, WOOD.hi)
  b.rect(rx + 2, ry + 6, 60, 28, WOOD.mid)
  b.rect(rx + 6, ry + 10, 24, 20, WOOD.dark)
  b.rect(rx + 34, ry + 10, 24, 20, WOOD.dark)
  b.hline(rx + 6, ry + 10, 24, WOOD.deep)
  b.hline(rx + 34, ry + 10, 24, WOOD.deep)
  b.set(rx + 28, ry + 20, 0xffc94a)
  b.set(rx + 36, ry + 20, 0xffc94a)
  b.rect(rx + 4, ry + 34, 4, 10, WOOD.deep)
  b.rect(rx + 56, ry + 34, 4, 10, WOOD.deep)
  // TV de tubo: gabinete e moldura da tela
  const tx = 394
  const ty = 144
  b.ditherA(tx, ty + 46, 56, 4, 0x0f0b09, 0.9, 150)
  b.rect(tx, ty, 54, 46, 0x6b4428)
  b.rect(tx, ty, 54, 2, 0x8a5a34)
  b.vline(tx, ty, 46, 0x8a5a34)
  b.vline(tx + 53, ty, 46, 0x3b2615)
  b.hline(tx, ty + 45, 54, 0x3b2615)
  b.rect(tx + 3, ty + 4, 38, 38, 0x0f0b09)
  b.rect(tx + 4, ty + 5, 36, 36, 0x221c19)
  b.rect(tx + 44, ty + 8, 7, 7, 0xe0a92e)
  b.ellipse(tx + 47.5, ty + 11.5, 2.6, 2.6, 0xffc94a)
  b.ellipse(tx + 47.5, ty + 22.5, 2.6, 2.6, 0xd9ccb8)
  for (let i = 0; i < 5; i++) b.hline(tx + 44, ty + 30 + i * 2, 7, 0x2f1d12)
  // antena de coelho
  b.line(tx + 20, ty - 1, tx + 12, ty - 8, 0xb7a99a)
  b.line(tx + 26, ty - 1, tx + 36, ty - 7, 0xb7a99a)
  b.rect(tx + 18, ty - 3, 10, 3, 0x3b312c)
  // plantinha de vaso grande
  const px = 460
  b.rect(px, 214, 18, 20, 0xc9663a)
  b.rect(px - 2, 212, 22, 4, 0xe08a55)
  b.hline(px - 2, 212, 22, 0xf3a875)
  b.rect(px + 12, 216, 5, 18, 0x9a4a28)
  b.hline(px, 233, 18, 0x6b2f18)
  const leaves = [
    [px + 9, 212, -22, -40],
    [px + 9, 212, 6, -52],
    [px + 9, 212, 26, -34],
    [px + 9, 212, -6, -26],
    [px + 9, 212, 16, -22]
  ]
  for (const [sx, sy, dx, dy] of leaves as [number, number, number, number][]) {
    for (let k = 0; k <= 10; k++) {
      const f = k / 10
      const lx = sx + dx * f
      const ly = sy + dy * f + (f * f * 8)
      const r = 1 + Math.sin(f * Math.PI) * 4.2
      b.ellipse(lx, ly, r, r * 0.8, k % 2 ? 0x3fa070 : 0x4d7f4a)
      if (k % 3 === 0) b.ellipse(lx - 1, ly - 1, r * 0.5, r * 0.4, 0x6fd49b)
    }
  }
}

function ceilingLampMount(b: Buf): void {
  b.rect(236, 8, 8, 4, 0x3b312c)
  b.hline(236, 8, 8, 0x5e5048)
}

// ============================================================ elementos animados

function curtainElem(id: string, x: number, flip: boolean): AnimElem {
  const W = 18
  const H = 140
  return {
    id,
    layer: 'back',
    w: W + 6,
    h: H,
    key: (t, env) => (env.reduced ? 0 : Math.floor(t / 400) % 16),
    pos: () => ({ x: x - 3, y: 17 }),
    paint(b, _t, _e, key) {
      const ph = (key / 16) * Math.PI * 2
      for (let j = 0; j < H; j++) {
        const amp = Math.pow(j / H, 1.6) * 3
        const off = Math.round(Math.sin(ph + j * 0.03) * amp) + 3 + (flip ? 0 : 0)
        const w = W - Math.round((j / H) * 3)
        for (let i = 0; i < w; i++) {
          const fold = Math.floor((i + (flip ? 1 : 0)) / 3) % 2
          let c = fold ? 0x6e2a24 : 0x8a3a30
          if (i % 3 === 0) c = 0x4a1a16
          if (j < 5) c = 0x4a1a16
          if (bayer(i, j) < 0.1 && fold) c = 0xa8392f
          b.set(off + i + (flip ? 3 : 0), j, c)
        }
        if (j > H - 4) b.hline(off + (flip ? 3 : 0), j, w, 0x3b1411)
      }
      // laço (presilha) dourado
      b.rect(flip ? 5 : 12, 60, 6, 3, 0xffc94a)
    }
  }
}

const GLASS_CLIP = (b: Buf, gx: number, gy: number, x: number, y: number, el: Buf): void => {
  void b
  void gx
  void gy
  void x
  void y
  void el
}
void GLASS_CLIP

function cityWindows(): AnimElem {
  const W = GL.w
  const H = GL.h
  return {
    id: 'city-windows',
    layer: 'far',
    w: W,
    h: H,
    key: (t, env) => (env.reduced ? 0 : Math.floor(t / 2500)),
    pos: () => ({ x: GL.x, y: GL.y }),
    paint(b, _t, _e, key) {
      // sobre os prédios estáticos desenhados no `far`: acende janelas sorteando por tempo
      let x = 0
      let i = 0
      while (x < W) {
        const w = 8 + Math.floor(hash01(i, 5) * 9)
        const h = 22 + Math.floor(hash01(i, 6) * 26)
        for (let jy = 4; jy < h - 3; jy += 5)
          for (let jx = 2; jx < w - 2; jx += 4) {
            const on = hash01(i, jx, jy + Math.floor(key / 3) * 7 + (hash01(i, jx, jy) > 0.8 ? key : 0)) > 0.58
            if (on) b.rect(x + jx, H - h + jy, 2, 3, hash01(i, jx, jy) > 0.8 ? 0xf3ebdd : 0xffc94a)
          }
        x += w + 1
        i++
      }
    }
  }
}

function cloudElem(id: string, y: number, w: number, h: number, speed: number, seed: number, off: number): AnimElem {
  const buf = cloudBuf(w, h, seed, 0x2b3a60, 0x1d2744, 0x4a5d8a)
  return {
    id,
    layer: 'far',
    w,
    h,
    key: () => 0,
    pos: (t, env) => {
      const tt = tOf(t, env)
      const span = GL.w + w * 2
      const x = ((tt / 1000) * speed + off) % span
      return { x: GL.x + GL.w + w - x - w, y }
    },
    paint: (b) => b.blit(buf, 0, 0)
  }
}

function planeElem(): AnimElem {
  return {
    id: 'aviao',
    layer: 'far',
    w: 12,
    h: 6,
    key: (t, env) => (env.reduced ? 0 : Math.floor(t / 500) % 2),
    pos: (t, env) => {
      if (env.reduced) return null
      const c = (t / 1000) % 42
      if (c > 9) return null
      return { x: GL.x + Math.round(c * 7) - 10, y: GL.y + 14 + Math.round(c * 0.5) }
    },
    paint(b, _t, _e, key) {
      b.rect(1, 3, 8, 1, 0xb7a99a)
      b.rect(4, 2, 2, 1, 0x948779)
      b.set(8, 2, 0x948779)
      b.set(0, 3, 0x7a6c60)
      b.set(3, 4, 0x948779)
      if (key) b.set(9, 3, 0xff7a6b)
      else b.set(4, 4, 0xf3ebdd)
    }
  }
}

function lamp(): AnimElem[] {
  const SW = (t: number, env: Env) => (env.reduced ? 0 : Math.round(Math.sin(t / 900) * 5))
  const shade: AnimElem = {
    id: 'abajur',
    layer: 'back',
    w: 40,
    h: 76,
    key: (t, env) => SW(t, env) + 8,
    pos: () => ({ x: 220, y: 8 }),
    paint(b, _t, _e, key) {
      const s = key - 8
      // fio do teto até o abajur
      b.line(20, 0, 20 + s, 44, 0x0f0b09)
      b.line(21, 0, 21 + s, 44, 0x3b312c)
      const x = 20 + s
      // cúpula de tecido (trapézio) e luz saindo por baixo
      for (let j = 0; j < 20; j++) {
        const half = 7 + Math.round(j * 0.45)
        for (let i = -half; i <= half; i++) {
          let c = 0xe0a92e
          if (i < -half + 3) c = 0xffc94a
          if (i > half - 4) c = 0xa8791f
          if (j < 3) c = i % 2 ? 0xffc94a : 0xe0a92e
          if (j > 17) c = 0x8b6a1a
          b.set(x + i, 44 + j, c)
        }
      }
      b.rect(x - 2, 40, 5, 4, 0x3b312c)
      b.rect(x - 13, 62, 27, 2, 0xffe9a6)
      b.ditherA(x - 12, 64, 25, 3, 0xffe9a6, 0.8, 255)
      // lâmpada brilhando
      b.ellipse(x, 66, 3, 2, 0xfff6cf)
    }
  }
  const cone: AnimElem = {
    id: 'cone-de-luz',
    layer: 'back',
    w: 200,
    h: 130,
    key: (t, env) => {
      const flick = !env.reduced && env.koAge < 450 ? 1 + (Math.floor(env.koAge / 90) % 2) : 0
      return (SW(t, env) + 8) * 4 + flick
    },
    pos: () => ({ x: 140, y: 70 }),
    paint(b, _t, _e, key) {
      const flick = key % 4
      const s = Math.floor(key / 4) - 8
      const k = flick === 2 ? 0.45 : flick === 1 ? 0.75 : 1
      const ox = 100 + s * 0.8
      for (let y = 0; y < 130; y++) {
        const half = 14 + y * 0.74
        for (let x = Math.floor(ox - half); x <= Math.ceil(ox + half); x++) {
          if (x < 0 || x >= 200) continue
          const d = Math.abs(x - ox) / half
          const f = Math.max(0, (1 - d) * (1 - y / 170))
          if (f * 0.95 * k > bayer(x, y)) b.blend(x, y, f > 0.55 ? 0xfff0b8 : 0xffc94a, f > 0.55 ? 90 : 64)
        }
      }
    }
  }
  const dust: AnimElem = {
    id: 'poeira',
    layer: 'back',
    w: 150,
    h: 120,
    key: (t, env) => (env.reduced ? 0 : Math.floor(t / 180)),
    pos: () => ({ x: 165, y: 82 }),
    paint(b, _t, _e, key) {
      for (let i = 0; i < 18; i++) {
        const ph = key * 0.05 + hash01(i, 1) * 10
        const x = Math.round(75 + (hash01(i, 2) - 0.5) * (40 + hash01(i, 3) * 90) + Math.sin(ph) * 4)
        const y = Math.round(((hash01(i, 4) * 120 + key * (0.5 + hash01(i, 5) * 0.8)) % 120))
        const lim = 20 + y * 0.6
        if (Math.abs(x - 75) > lim) continue
        const tw = (key + i * 3) % 6
        if (tw < 4) b.set(x, y, tw < 2 ? 0xfff0b8 : 0xe0a92e)
        if (tw === 0) {
          b.set(x + 1, y, 0xffc94a)
          b.set(x, y + 1, 0xffc94a)
        }
      }
    }
  }
  return [shade, cone, dust]
}

function pendulum(): AnimElem {
  return {
    id: 'pendulo',
    layer: 'back',
    w: 16,
    h: 32,
    key: (t, env) => (env.reduced ? 3 : Math.floor(t / 250) % 8),
    pos: () => ({ x: 432, y: 55 }),
    paint(b, _t, _e, key) {
      const s = Math.round(Math.sin((key / 8) * Math.PI * 2) * 4)
      b.line(8, 0, 8 + s, 24, 0xb7a99a)
      b.ellipse(8 + s, 26, 3.5, 3.5, 0xe0a92e)
      b.ellipse(7.5 + s, 25, 1.4, 1.4, 0xffe9a6)
    }
  }
}

function steamElem(): AnimElem {
  return {
    id: 'vapor-xicara',
    layer: 'back',
    w: 14,
    h: 18,
    key: (t, env) => (env.reduced ? 0 : Math.floor(t / 220) % 8),
    pos: () => ({ x: 190, y: 106 }),
    paint(b, _t, _e, key) {
      for (let k = 0; k < 2; k++)
        for (let j = 0; j < 14; j++) {
          const x = 4 + k * 5 + Math.round(Math.sin((j + key * 1.3 + k * 2) * 0.55) * 2)
          if ((j + key + k) % 4 !== 0) b.set(x, 16 - j, j > 9 ? 0x8b7e70 : j > 5 ? 0xb7a99a : 0xf3ebdd)
        }
    }
  }
}

function catElem(): AnimElem {
  return {
    id: 'gato',
    layer: 'back',
    w: 40,
    h: 30,
    key: (t, env) => {
      const scared = !env.reduced && env.koAge < 1800 ? 1 : 0
      const tail = env.reduced ? 0 : Math.floor(t / 350) % 6
      const ear = !env.reduced && Math.floor(t / 100) % 50 < 2 ? 1 : 0
      const breath = env.reduced ? 0 : Math.floor(t / 900) % 2
      return scared * 1000 + tail * 100 + ear * 10 + breath
    },
    pos: () => ({ x: 34, y: 182 }),
    paint(b, _t, _e, key) {
      const scared = key >= 1000
      const tail = Math.floor((key % 1000) / 100)
      const ear = Math.floor((key % 100) / 10)
      const breath = key % 2
      const fur = 0xd9954f
      const dark = 0xa9743f
      const light = 0xf0b878
      if (scared) {
        // arqueado, pelos em pé, olhos arregalados
        b.ellipse(18, 22, 14, 8, fur)
        b.ellipse(18, 16, 11, 9, fur)
        for (let i = 0; i < 9; i++) b.set(8 + i * 2, 7 + (i % 2), dark)
        b.ellipse(31, 14, 6, 5, fur)
        b.set(28, 8, dark)
        b.set(29, 7, fur)
        b.set(34, 8, fur)
        b.set(35, 7, dark)
        b.rect(29, 13, 2, 3, 0xf3ebdd)
        b.rect(33, 13, 2, 3, 0xf3ebdd)
        b.set(30, 14, 0x0f0b09)
        b.set(34, 14, 0x0f0b09)
        b.set(32, 17, 0xff7a6b)
        // rabo em pé, estufado
        for (let k = 0; k < 12; k++) b.ellipse(4 - k * 0.15, 20 - k * 1.3, 2.2, 2, k % 3 ? fur : dark)
        b.set(14, 3, 0xffc94a)
        b.rect(14, 0, 1, 2, 0xffc94a)
        return
      }
      // dormindo enrolado
      const by = breath
      b.ellipse(18, 21 - by * 0.0, 15, 7 + by * 0.5, fur)
      b.ellipse(18, 18, 12, 6, fur)
      for (let i = 0; i < 5; i++) b.vline(9 + i * 4, 15 + (i % 2), 5, dark)
      b.ellipse(30, 21, 5.5, 4.5, fur) // cabeça
      b.hline(28, 22, 4, 0x0f0b09) // olho fechado
      b.hline(33, 22, 2, 0x0f0b09)
      b.set(33, 24, 0xff7a6b)
      b.set(26, 17 - ear, dark)
      b.set(27, 16 - ear, fur)
      b.set(27, 17 - ear, fur)
      b.set(33, 17, fur)
      b.set(34, 16, dark)
      b.set(34, 17, fur)
      b.set(30, 19, light)
      // rabo balança na beira do assento
      const sw = [0, 1, 2, 2, 1, 0][tail]!
      for (let k = 0; k < 10; k++) b.ellipse(5 - k * 0.5 + 0, 26 + Math.round(k * 0.25) - Math.round(Math.sin((k / 10) * 2.5 + sw) * 1.5) , 1.6, 1.6, k % 4 === 3 ? dark : fur)
    }
  }
}

function tvScreen(): AnimElem {
  const W = 36
  const H = 36
  return {
    id: 'tv-programa',
    layer: 'back',
    w: W,
    h: H,
    key: (t, env) => (env.reduced ? 20 : Math.floor(t / 110) % 80),
    pos: () => ({ x: 398, y: 149 }),
    paint(b, _t, _e, key) {
      const bars = [0xf3ebdd, 0xffc94a, 0x7fb7e6, 0x6fd49b, 0xe58ac4, 0xff7a6b, 0x5b7c99]
      if (key < 10) {
        // barras de cor
        for (let i = 0; i < 7; i++) b.rect(Math.floor((i * W) / 7), 0, Math.ceil(W / 7), H - 8, bars[i]!)
        for (let i = 0; i < 7; i++) b.rect(Math.floor((i * W) / 7), H - 8, Math.ceil(W / 7), 8, i % 2 ? 0x221c19 : bars[6 - i]!)
      } else if (key < 14) {
        // chiado
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) b.set(i, j, hash01(i, j, key) > 0.5 ? 0xd9ccb8 : hash01(i, j, key + 1) > 0.5 ? 0x5e5048 : 0x221c19)
      } else {
        // programa: desenho com um jogador pulando
        const f = key - 14
        b.rect(0, 0, W, H, 0x7fb7e6)
        b.dither(0, 14, W, 10, 0x7fb7e6, 0xbfe3f5, 0.5)
        b.ellipse(28, 8, 4, 4, 0xffe9a6)
        b.ellipse(28, 8, 3, 3, 0xffc94a)
        for (let i = 0; i < W; i++) {
          const hh = 6 + Math.round(Math.sin(i * 0.25) * 2)
          b.rect(i, H - 12 - hh + 8, 1, hh + 4, i % 2 ? 0x4d7f4a : 0x3c6a3d)
        }
        b.rect(0, H - 8, W, 8, 0x678f4c)
        const cx = ((f * 2) % (W + 12)) - 6
        const jump = Math.abs(Math.sin(f * 0.35)) * 9
        const cy = H - 14 - jump
        b.rect(cx, cy, 5, 4, 0xffc94a)
        b.rect(cx + 1, cy - 1, 3, 1, 0xffc94a)
        b.rect(cx, cy + 4, 5, 4, 0xff7a6b)
        b.set(cx + 3, cy + 2, 0x0f0b09)
        b.rect(cx, cy + 8, 2, 2, 0x3b312c)
        b.rect(cx + 3, cy + 8, 2, 2, 0x3b312c)
        if (f % 24 < 3) b.rect(0, 4, W, 1, 0xf3ebdd)
      }
      // varredura e escurecido nos cantos
      for (let j = 0; j < H; j += 2) b.blendRect(0, j, W, 1, 0x0f0b09, 46)
      for (const [cx, cy] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]] as const) {
        b.set(cx, cy, 0x221c19)
        b.set(cx === 0 ? 1 : cx - 1, cy, 0x221c19)
        b.set(cx, cy === 0 ? 1 : cy - 1, 0x221c19)
      }
    }
  }
}

function tvGlow(): AnimElem {
  return {
    id: 'tv-brilho',
    layer: 'back',
    w: 100,
    h: 80,
    key: (t, env) => (env.reduced ? 0 : Math.floor(t / 300) % 3),
    pos: () => ({ x: 370, y: 140 }),
    paint(b, _t, _e, key) {
      for (let y = 0; y < 80; y++)
        for (let x = 0; x < 100; x++) {
          const d = Math.sqrt(((x - 40) / 60) ** 2 + ((y - 28) / 44) ** 2)
          const f = Math.max(0, 1 - d) * (0.5 + key * 0.08)
          if (f > bayer(x, y)) b.blend(x, y, 0x7fb7e6, 34)
        }
    }
  }
}

function fish(): AnimElem[] {
  const X = 404
  const Y = 98
  const fishE: AnimElem = {
    id: 'peixe',
    layer: 'back',
    w: 10,
    h: 8,
    key: (t, env) => {
      const tt = tOf(t, env)
      const c = (tt / 1000 / 7) % 2
      const dir = c < 1 ? 0 : 1
      const bob = Math.floor(tt / 300) % 2
      return dir * 2 + bob
    },
    pos: (t, env) => {
      const tt = tOf(t, env)
      const c = (tt / 1000 / 7) % 2
      const f = c < 1 ? c : 2 - c
      return { x: X + 8 + Math.round(f * 40), y: Y + 12 + Math.round(Math.sin(tt / 900) * 3) }
    },
    paint(b, _t, _e, key) {
      const left = key >= 2
      const wag = key % 2
      const body = (x: number) => (left ? 9 - x : x)
      b.ellipse(body(5), 4, 3.6, 2.6, 0xff7a6b)
      b.set(body(7), 3, 0xf3ebdd)
      b.set(body(7), 3, 0x0f0b09)
      b.set(body(5), 2, 0xffc94a)
      b.set(body(5), 5, 0xffc94a)
      for (let k = 0; k < 3; k++) b.set(body(1 - (k > 0 ? 0 : 0)), 3 + k - 1 + (wag && k === 1 ? 1 : 0), 0xd9594b)
      b.set(body(0), 2 + wag, 0xd9594b)
      b.set(body(0), 5 - wag, 0xd9594b)
    }
  }
  const bubbles: AnimElem = {
    id: 'bolhas',
    layer: 'back',
    w: 10,
    h: 28,
    key: (t, env) => (env.reduced ? 0 : Math.floor(t / 150) % 40),
    pos: () => ({ x: X + 50, y: Y + 2 }),
    paint(b, _t, _e, key) {
      for (let i = 0; i < 3; i++) {
        const y = 26 - ((key + i * 13) % 40) * 0.7
        if (y < 0) continue
        const x = 4 + Math.round(Math.sin((key + i * 5) * 0.4) * 1.5) + i - 1
        b.set(x, Math.round(y), 0xe7f4fb)
        if (i === 0) b.set(x + 1, Math.round(y) - 1, 0xbfe3f5)
      }
    }
  }
  return [fishE, bubbles]
}

export function buildEstante(): ArenaArt {
  const far = new Buf(ARENA_W, ARENA_H)
  const back = new Buf(ARENA_W, ARENA_H)
  const front = new Buf(ARENA_W, ARENA_H)
  const mask = new Uint8Array(ARENA_W * ARENA_H)
  wallpaper(back)
  floor(back)
  bookcase(back)
  armchair(back)
  windowFrame(back, far, mask)
  ceilingLampMount(back)
  wallClock(back)
  aquariumStatic(back)
  tvAndRack(back)
  const [p0, p1, p2, p3] = ARENA_PLATFORMS.estante
  void p0
  // livros e objetinhos nas prateleiras (antes das tábuas: assim a tábua fica por cima do pé dos livros)
  const [, s1, s2, s3] = [p0!, p1!, p2!, p3!]
  bookRow(back, s1.x + 4, s1.x + 62, s1.y, 3, 17)
  bookRow(back, s2.x + 4, s2.x + 42, s2.y, 11, 15)
  bookRow(back, s3.x + 6, s3.x + 38, s3.y, 21, 18)
  // xícara na prateleira da esquerda
  back.rect(s1.x + 66, s1.y - 9, 10, 9, 0xf3ebdd)
  back.vline(s1.x + 74, s1.y - 9, 9, 0xd9ccb8)
  back.hline(s1.x + 66, s1.y - 9, 10, 0x4a2e1b)
  back.ellipse(s1.x + 78, s1.y - 5, 2.5, 3, 0xf3ebdd)
  back.set(s1.x + 78, s1.y - 5, 0x2e2622)
  back.rect(s1.x + 67, s1.y - 4, 7, 1, 0xff7a6b)
  // vasinho com flor na prateleira da direita
  const vx = s2.x + 54
  back.rect(vx, s2.y - 8, 9, 8, 0xc9663a)
  back.hline(vx - 1, s2.y - 8, 11, 0xe08a55)
  back.line(vx + 4, s2.y - 9, vx + 5, s2.y - 17, 0x3fa070)
  back.ellipse(vx + 5, s2.y - 19, 3, 3, 0xff7a6b)
  back.set(vx + 5, s2.y - 19, 0xffc94a)
  back.line(vx + 4, s2.y - 12, vx + 8, s2.y - 15, 0x4d7f4a)
  // porta-retrato e globinho na prateleira de cima
  back.rect(s3.x + 44, s3.y - 14, 12, 14, 0x8a5a34)
  back.rect(s3.x + 46, s3.y - 12, 8, 10, 0x7fb7e6)
  back.rect(s3.x + 46, s3.y - 6, 8, 4, 0x4d7f4a)
  back.ellipse(s3.x + 50, s3.y - 9, 1.5, 1.5, 0xffc94a)
  back.ellipse(s3.x + 63, s3.y - 5, 4, 4, 0x4f8fc4)
  back.rect(s3.x + 62, s3.y - 1, 3, 1, 0x3b312c)
  back.set(s3.x + 61, s3.y - 7, 0xbfe3f5)
  for (const p of ARENA_PLATFORMS.estante.slice(1)) shelf(back, mask, p.x, p.y, p.w)
  cabinet(back, mask)
  // frente leve: sombra pontilhada no chão na frente do móvel e bordas
  front.ditherA(96, 234, 288, 8, 0x0f0b09, 0.55, 120)
  const anims: AnimElem[] = [
    cityWindows(),
    cloudElem('nuvem-a', GL.y + 70, 34, 12, 3.2, 1, 5),
    cloudElem('nuvem-b', GL.y + 40, 26, 9, 2, 2, 52),
    planeElem(),
    curtainElem('cortina-esq', 6, false),
    curtainElem('cortina-dir', 80, true),
    ...lamp(),
    pendulum(),
    steamElem(),
    catElem(),
    tvGlow(),
    tvScreen(),
    ...fish()
  ]
  void hash2
  return { id: 'estante', far, back, front, anims, platformMask: mask, wall: 0x221c19 }
}
