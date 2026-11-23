/**
 * Peças do xadrez em voxel (cubinhos), feitas a partir da MESMA pixel art 16x16 do tabuleiro 2D
 * (`../scene/pieces.ts`). Sem Three e sem DOM: o teste importa daqui.
 *
 * - Peças redondas (peão, torre, bispo, dama, rei): cada linha do desenho vira uma camada; o voxel
 *   (x, z) entra se as colunas x e z daquela linha estão pintadas e se ele cabe no círculo da largura
 *   da linha. Assim a coroa e as ameias da torre aparecem e o corpo fica arredondado, em degraus.
 * - Cavalo: o desenho de lado é extrudado (espessura fixa), com a base redonda como as outras.
 *
 * Cor: a linha que só tem contorno (k) vira "friso" (cor escura); o resto é o corpo.
 * Coordenadas: x e z de 0 a 15 (centro em 7,5), y de 0 (chão) a 15.
 */
import type { PieceType } from '../../../../shared/games/chess/rules'
import { PIECES, PIECE_SIZE } from '../scene/pieces'

export interface Voxel {
  x: number
  y: number
  z: number
  trim: boolean
}

const N = PIECE_SIZE
const C = (N - 1) / 2

/** a linha só tem contorno: vira friso */
const isTrimRow = (row: string): boolean => !/[fhs]/.test(row)

function span(row: string): { lo: number; hi: number } | null {
  const lo = row.search(/[^.]/)
  if (lo < 0) return null
  let hi = row.length - 1
  while (row[hi] === '.') hi--
  return { lo, hi }
}

/** primeira linha (de baixo para cima) da base do cavalo: a partir dela, a peça é redonda */
const KNIGHT_BASE_FROM = 11
/** espessura do cavalo (voxels), centrada */
const KNIGHT_DEPTH = 6

export function pieceVoxels(type: PieceType): Voxel[] {
  const rows = PIECES[type]
  const out: Voxel[] = []
  rows.forEach((row, ry) => {
    const sp = span(row)
    if (!sp) return
    const y = N - 1 - ry
    const trim = isTrimRow(row)
    const r = (sp.hi - sp.lo + 1) / 2
    const extrude = type === 'n' && ry < KNIGHT_BASE_FROM
    for (let x = 0; x < N; x++) {
      if (row[x] === '.') continue
      for (let z = 0; z < N; z++) {
        if (extrude) {
          if (Math.abs(z - C) > KNIGHT_DEPTH / 2) continue
        } else {
          if (row[z] === '.') continue
          // arredonda: corta os cantos do quadrado
          if ((x - C) * (x - C) + (z - C) * (z - C) > (r + 0.35) * (r + 0.35)) continue
        }
        out.push({ x, y, z, trim })
      }
    }
  })
  return out
}

export interface MeshArrays {
  /** 3 números por vértice */
  pos: number[]
  normal: number[]
  /** 1 = friso, 0 = corpo (um por vértice) */
  trim: number[]
  /** índices de triângulos */
  index: number[]
}

const FACES: Array<{ n: [number, number, number]; v: [number, number, number][] }> = [
  {
    n: [1, 0, 0],
    v: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1]
    ]
  },
  {
    n: [-1, 0, 0],
    v: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0]
    ]
  },
  {
    n: [0, 1, 0],
    v: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0]
    ]
  },
  {
    n: [0, -1, 0],
    v: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1]
    ]
  },
  {
    n: [0, 0, 1],
    v: [
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [0, 0, 1]
    ]
  },
  {
    n: [0, 0, -1],
    v: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0]
    ]
  }
]

/**
 * Malha dos voxels, só com as faces que aparecem (a que encosta em outro voxel some).
 * `size` = tamanho de um voxel; a peça fica centrada em x e z, com o pé em y = 0.
 */
export function voxelMesh(voxels: readonly Voxel[], size: number): MeshArrays {
  const key = (x: number, y: number, z: number) => (x * 64 + y) * 64 + z
  const filled = new Set(voxels.map((v) => key(v.x + 1, v.y + 1, v.z + 1)))
  const m: MeshArrays = { pos: [], normal: [], trim: [], index: [] }
  for (const v of voxels) {
    for (const f of FACES) {
      if (filled.has(key(v.x + 1 + f.n[0], v.y + 1 + f.n[1], v.z + 1 + f.n[2]))) continue
      const base = m.pos.length / 3
      for (const [dx, dy, dz] of f.v) {
        m.pos.push((v.x + dx - N / 2) * size, (v.y + dy) * size, (v.z + dz - N / 2) * size)
        m.normal.push(...f.n)
        m.trim.push(v.trim ? 1 : 0)
      }
      m.index.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }
  return m
}
