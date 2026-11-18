import { describe, expect, it } from 'vitest'
import { BudgetCore, parseGb, type BudgetStorage } from '../src/worker/budget'

class MemStorage implements BudgetStorage {
  map = new Map<string, unknown>()
  async get<T>(k: string) {
    return this.map.get(k) as T | undefined
  }
  async put(k: string, v: unknown) {
    this.map.set(k, v)
  }
  async delete(k: string) {
    return this.map.delete(k)
  }
}

const GB = 1e9
const at = (iso: string) => Date.parse(iso)

function make(limits = { monthlyGb: 100, roomDailyGb: 10 }, start = '2026-11-18T12:00:00Z') {
  const storage = new MemStorage()
  const clock = { t: at(start) }
  const core = new BudgetCore(storage, () => clock.t, limits)
  return { storage, clock, core }
}

describe('BudgetCore', () => {
  it('estado da sala no dia: 70% economia, 100% esgotado', async () => {
    const { core } = make()
    expect(await core.report('s', 6.9 * GB)).toBe('ok')
    expect(await core.report('s', 0.1 * GB)).toBe('economia')
    expect(await core.peek('s')).toBe('economia')
    expect(await core.report('s', 3 * GB)).toBe('esgotado')
    // outra sala não é afetada
    expect(await core.peek('outra')).toBe('ok')
  })

  it('estado do mês: 70% economia, 90% esgotado (todas as salas somam)', async () => {
    const { core } = make({ monthlyGb: 100, roomDailyGb: 1000 })
    expect(await core.report('a', 40 * GB)).toBe('ok')
    expect(await core.report('b', 30 * GB)).toBe('economia')
    expect(await core.peek('c')).toBe('economia')
    expect(await core.report('c', 20 * GB)).toBe('esgotado')
  })

  it('devolve o pior entre mês e sala', async () => {
    const { core } = make({ monthlyGb: 100, roomDailyGb: 10 })
    await core.report('a', 75 * GB) // mês em economia (e a sala a estourou)
    expect(await core.peek('b')).toBe('economia')
    expect(await core.report('b', 10 * GB)).toBe('esgotado') // sala b cheia, mês 85%
    expect(await core.peek('b')).toBe('esgotado')
    expect(await core.peek('a')).toBe('esgotado')
  })

  it('a sala recomeça ao virar o dia, o mês só ao virar o mês', async () => {
    const { core, clock } = make({ monthlyGb: 1000, roomDailyGb: 10 }, '2026-11-18T23:59:00Z')
    expect(await core.report('s', 10 * GB)).toBe('esgotado')
    clock.t = at('2026-11-19T00:01:00Z')
    expect(await core.peek('s')).toBe('ok')
    expect(await core.report('s', 1 * GB)).toBe('ok')
    clock.t = at('2026-11-30T23:59:00Z')
    await core.report('s', 1)
    clock.t = at('2026-12-01T00:00:01Z')
    const mes = (await core.report('s', 5 * GB)) // mês novo começa do zero: só 5 GB
    expect(mes).toBe('ok')
    expect(await core.peek('s')).toBe('ok')
  })

  it('mês novo esquece o consumo do mês velho', async () => {
    const { core, clock } = make({ monthlyGb: 100, roomDailyGb: 1000 }, '2026-11-20T10:00:00Z')
    expect(await core.report('s', 95 * GB)).toBe('esgotado')
    clock.t = at('2026-12-01T00:00:00Z')
    expect(await core.peek('s')).toBe('ok')
  })

  it('apaga as salas paradas há mais de 3 dias e guarda as recentes', async () => {
    const { core, clock, storage } = make()
    await core.report('velha', 1)
    clock.t = at('2026-11-20T12:00:00Z')
    await core.report('media', 1)
    expect(storage.map.has('sala:velha')).toBe(true)
    clock.t = at('2026-11-22T12:00:00Z') // velha: 4 dias
    await core.report('nova', 1)
    expect(storage.map.has('sala:velha')).toBe(false)
    expect(storage.map.has('sala:media')).toBe(true)
    expect(storage.map.has('sala:nova')).toBe(true)
    expect(Object.keys(storage.map.get('salas') as object).sort()).toEqual(['media', 'nova'])
  })

  it('ignora bytes inválidos', async () => {
    const { core } = make()
    expect(await core.report('s', -5)).toBe('ok')
    expect(await core.report('s', Number.NaN)).toBe('ok')
  })

  it('parseGb usa o padrão para valores ruins', () => {
    expect(parseGb('900', 1)).toBe(900)
    expect(parseGb('0,5', 7)).toBe(7)
    expect(parseGb(undefined, 7)).toBe(7)
    expect(parseGb('', 7)).toBe(7)
    expect(parseGb('-3', 7)).toBe(7)
    expect(parseGb('1.5', 7)).toBe(1.5)
  })
})
