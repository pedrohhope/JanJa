/**
 * Gera PNGs de preview da Briga na Sala em /tmp/brawl-preview/ (ampliados 3x): folhas de sprites e quadros das arenas.
 * Uso: npx tsx scripts/brawl-preview.ts [folhas|arenas|tudo]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import type { CharacterId, Held } from '../src/shared/games/brawl/types'
import { CHARACTER_IDS } from '../src/shared/games/brawl/types'
import { ANIM_FRAMES, ANIM_NAMES, buildSet } from '../src/web/game/brawl/scene/anims'
import { BPAL, hexNum } from '../src/web/game/brawl/scene/palette'
import { Buf, hexToInt, rowsToBuf } from '../src/web/game/brawl/scene/raster'
import type { BrawlSimState } from '../src/shared/games/brawl/types'
import { pickAnim } from '../src/web/game/brawl/scene/animate'
import { PROJECTILE_ART, puddleRows, weaponRows } from '../src/web/game/brawl/scene/items'
import { AX } from '../src/web/game/brawl/scene/grid'
import { showcaseState } from '../src/web/game/brawl/scene/sample'

const OUT = '/tmp/brawl-preview'
const SCALE = 3

export function savePng(buf: Buf, file: string): void {
  const png = new PNG({ width: buf.w, height: buf.h })
  png.data = Buffer.from(buf.data)
  writeFileSync(file, PNG.sync.write(png))
}

const TINTS: Record<CharacterId, string> = { jan: '#FF7A6B', xicara: '#7FB7E6', teve: '#6FD49B', janja: '#FFC94A' }

/** quadro com a tinta do jogador no contorno */
export function frameBuf(rows: string[], tint: string): Buf {
  return rowsToBuf(rows, { ...BPAL, t: tint, T: tint })
}

/** desenha o estado no buffer, com a mesma escolha de animação da cena */
function drawState(out: Buf, st: BrawlSimState): void {
  for (const p of st.puddles) out.blit(rowsToBuf(puddleRows(Math.round(p.w)), BPAL), Math.round(p.x - p.w / 2), Math.round(p.y) - 3)
  for (const it of st.items) out.blit(rowsToBuf(weaponRows(it.weapon), BPAL), Math.round(it.x) - 16, Math.round(it.y) - 24)
  for (const f of st.fighters) {
    const pk = pickAnim(f, st.tick)
    const rows = buildSet(f.char, f.held)[pk.anim][pk.frame]!
    out.blit(frameBuf(rows, TINTS_SLOT[f.slot % 4]!), Math.round(f.x) - (f.facing > 0 ? AX : 31 - AX), Math.round(f.y) - 32, 1, f.facing < 0)
  }
  for (const p of st.projectiles) out.blit(rowsToBuf(PROJECTILE_ART[p.kind as 'carta'][0]!, BPAL), Math.round(p.x), Math.round(p.y))
}
const TINTS_SLOT = ['#FF7A6B', '#7FB7E6', '#6FD49B', '#FFC94A']

function sheet(char: CharacterId, held: Held, anims: readonly (typeof ANIM_NAMES)[number][]): Buf {
  const set = buildSet(char, held)
  const cols = Math.max(...anims.map((a) => ANIM_FRAMES[a]))
  const cell = 34
  const b = new Buf(cols * cell + 4, anims.length * cell + 4)
  b.rect(0, 0, b.w, b.h, hexNum('#2E2622'))
  anims.forEach((a, r) => {
    for (let i = 0; i < ANIM_FRAMES[a]; i++) {
      b.rect(2 + i * cell, 2 + r * cell, 32, 32, hexToInt('#221C19'))
      // linha do chão
      b.hline(2 + i * cell, 2 + r * cell + 31, 32, hexToInt('#4A3E37'))
      b.blit(frameBuf(set[a][i]!, TINTS[char]), 2 + i * cell, 2 + r * cell)
    }
  })
  return b
}

function sheets(): void {
  for (const c of CHARACTER_IDS) {
    savePng(sheet(c, 'mao', ANIM_NAMES).scaled(SCALE), `${OUT}/folha-${c}.png`)
    const key = ['idle', 'run', 'leve-lado', 'leve-baixo', 'ar-cima', 'forte-lado', 'forte-baixo'] as const
    for (const h of ['vassoura', 'frigideira', 'luvas'] as const) savePng(sheet(c, h, key).scaled(SCALE), `${OUT}/folha-${c}-${h}.png`)
  }
  console.log('animações (linhas de cima para baixo):', ANIM_NAMES.join(', '))
}

mkdirSync(OUT, { recursive: true })
const what = process.argv[2] ?? 'tudo'
if (what === 'folhas' || what === 'tudo') sheets()

if (what === 'equipe' || what === 'tudo') {
  // um quadro de cada personagem em poses-chave, ampliado 6x, para conferir o desenho
  const picks: [(typeof ANIM_NAMES)[number], number][] = [['idle', 0], ['run', 1], ['leve-lado', 1], ['forte-neutro', 2], ['forte-lado', 2], ['forte-baixo', 2], ['hurt', 1], ['win', 0]]
  const b = new Buf(picks.length * 34 + 4, CHARACTER_IDS.length * 34 + 4)
  b.rect(0, 0, b.w, b.h, hexNum('#2E2622'))
  CHARACTER_IDS.forEach((c, r) =>
    picks.forEach(([a, i], k) => {
      b.rect(2 + k * 34, 2 + r * 34, 32, 32, hexToInt('#221C19'))
      b.blit(frameBuf(buildSet(c, 'vassoura')[a][i]!, TINTS[c]), 2 + k * 34, 2 + r * 34)
    })
  )
  savePng(b.scaled(4), `${OUT}/equipe.png`)
}

if (what === 'arenas' || what === 'tudo') {
  const { buildArena, composeArena, CALM_ENV } = await import('../src/web/game/brawl/scene/arenaArt')
  const { ARENA_IDS } = await import('../src/shared/games/brawl/types')
  for (const id of ARENA_IDS) {
    const art = buildArena(id)
    for (const [i, t] of [1000, 4300, 9100, 15600].entries()) savePng(composeArena(art, t, CALM_ENV).scaled(SCALE), `${OUT}/arena-${id}-t${i}.png`)
    // quadro completo: arena + 4 lutadores, arma no chão, carta e poça
    const st = showcaseState(id)
    const out = composeArena(art, 4300, CALM_ENV, false)
    drawState(out, st)
    out.blit(art.front, 0, 0)
    savePng(out.scaled(SCALE), `${OUT}/arena-${id}-lutadores.png`)
    // reação ao nocaute e "reduzir movimento"
    savePng(composeArena(art, 4300, { reduced: false, koAge: 300, koSide: 'esquerda' }).scaled(SCALE), `${OUT}/arena-${id}-ko.png`)
    savePng(composeArena(art, 4300, { reduced: true, koAge: Infinity, koSide: null }).scaled(SCALE), `${OUT}/arena-${id}-parado.png`)
  }
}
