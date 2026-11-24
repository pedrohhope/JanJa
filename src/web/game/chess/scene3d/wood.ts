/**
 * Veio de madeira gerado por código (puro: o teste importa daqui). Devolve tons de 0 a 1;
 * o modo realista pinta com as cores da madeira num canvas.
 */

/** ruído suave determinístico (valor em grade com interpolação) */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function noise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash(xi, yi, seed)
  const b = hash(xi + 1, yi, seed)
  const c = hash(xi, yi + 1, seed)
  const d = hash(xi + 1, yi + 1, seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

function fbm(x: number, y: number, seed: number): number {
  return noise(x, y, seed) * 0.6 + noise(x * 2.1, y * 2.1, seed + 7) * 0.28 + noise(x * 4.3, y * 4.3, seed + 13) * 0.12
}

export interface GrainOpts {
  seed: number
  /** o veio corre ao longo de x (padrão) ou de y */
  alongY?: boolean
  /** quantos anéis por 100 px */
  rings?: number
  /** quanto o veio ondula */
  wobble?: number
}

/** tom da madeira em (x, y), de 0 (veio escuro) a 1 (claro) */
export function grain(x: number, y: number, o: GrainOpts): number {
  const s = o.alongY ? y : x
  const t = o.alongY ? x : y
  const rings = o.rings ?? 6
  const wob = o.wobble ?? 14
  const w = fbm(s * 0.006, t * 0.03, o.seed) * wob
  const ring = 0.5 + 0.5 * Math.sin(((t + w) * rings * Math.PI * 2) / 100)
  // anéis com borda dura de um lado, como madeira de verdade
  const band = ring ** 3
  const fibre = noise(s * 0.02, t * 0.9, o.seed + 3)
  const v = 0.62 + 0.25 * (1 - band) + 0.13 * fibre
  return Math.max(0, Math.min(1, v))
}

/** mistura duas cores (#RRGGBB) pelo tom; devolve RGBA para um ImageData */
export function paintGrain(out: Uint8ClampedArray, w: number, x0: number, y0: number, sw: number, sh: number, dark: string, light: string, o: GrainOpts): void {
  const d = [1, 3, 5].map((i) => parseInt(dark.slice(i, i + 2), 16))
  const l = [1, 3, 5].map((i) => parseInt(light.slice(i, i + 2), 16))
  for (let y = y0; y < y0 + sh; y++)
    for (let x = x0; x < x0 + sw; x++) {
      const t = grain(x, y, o)
      const k = (y * w + x) * 4
      out[k] = d[0] + (l[0] - d[0]) * t
      out[k + 1] = d[1] + (l[1] - d[1]) * t
      out[k + 2] = d[2] + (l[2] - d[2]) * t
      out[k + 3] = 255
    }
}
