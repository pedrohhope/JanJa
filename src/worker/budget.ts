import { worstBudget, type BudgetState } from '../shared/sfu'

/**
 * Orçamento de tráfego do SFU, sem nada da Cloudflare (testável no Node).
 * Soma os bytes no mês UTC (`mes:AAAA-MM`) e no dia de cada sala (`sala:<roomId>` = { dia, bytes }, que
 * recomeça ao virar o dia). Um índice (`salas`) lembra o último dia de cada sala para apagar as paradas há mais de 3 dias.
 */

export interface BudgetStorage {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  delete?(key: string): Promise<unknown>
}

export interface BudgetLimits {
  /** GB decimais (1 GB = 1e9 bytes) por mês, para o SFU inteiro */
  monthlyGb: number
  /** GB decimais por dia, para cada sala */
  roomDailyGb: number
}

export const DEFAULT_MONTHLY_GB = 900
export const DEFAULT_ROOM_DAILY_GB = 60
const GB = 1e9
const KEEP_DAYS = 3
const DAY_MS = 86_400_000

interface RoomDay {
  dia: string
  bytes: number
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** número positivo vindo de uma variável de ambiente em texto; senão o padrão */
export function parseGb(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return value !== undefined && value.trim() !== '' && Number.isFinite(n) && n > 0 ? n : fallback
}

export function monthState(bytes: number, limitGb: number): BudgetState {
  const limit = limitGb * GB
  return bytes >= limit * 0.9 ? 'esgotado' : bytes >= limit * 0.7 ? 'economia' : 'ok'
}

export function roomState(bytes: number, limitGb: number): BudgetState {
  const limit = limitGb * GB
  return bytes >= limit ? 'esgotado' : bytes >= limit * 0.7 ? 'economia' : 'ok'
}

export class BudgetCore {
  constructor(
    private readonly storage: BudgetStorage,
    private readonly now: () => number,
    private readonly limits: BudgetLimits
  ) {}

  private monthKey(): string {
    return `mes:${day(this.now()).slice(0, 7)}`
  }

  private state(mes: number, sala: number): BudgetState {
    return worstBudget(monthState(mes, this.limits.monthlyGb), roomState(sala, this.limits.roomDailyGb))
  }

  private async roomBytesToday(roomId: string): Promise<number> {
    const v = await this.storage.get<RoomDay>(`sala:${roomId}`)
    return v && v.dia === day(this.now()) ? v.bytes : 0
  }

  async peek(roomId: string): Promise<BudgetState> {
    const mes = (await this.storage.get<number>(this.monthKey())) ?? 0
    return this.state(mes, await this.roomBytesToday(roomId))
  }

  async report(roomId: string, bytes: number): Promise<BudgetState> {
    const add = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
    const hoje = day(this.now())
    const mesKey = this.monthKey()
    const mes = ((await this.storage.get<number>(mesKey)) ?? 0) + add
    const sala = (await this.roomBytesToday(roomId)) + add
    await this.storage.put(mesKey, mes)
    await this.storage.put(`sala:${roomId}`, { dia: hoje, bytes: sala } satisfies RoomDay)
    await this.prune(roomId, hoje)
    return this.state(mes, sala)
  }

  /** atualiza o índice e apaga as salas sem uso há mais de KEEP_DAYS dias */
  private async prune(roomId: string, hoje: string): Promise<void> {
    const index = (await this.storage.get<Record<string, string>>('salas')) ?? {}
    const limite = day(this.now() - KEEP_DAYS * DAY_MS)
    let changed = index[roomId] !== hoje
    index[roomId] = hoje
    for (const [id, dia] of Object.entries(index)) {
      if (dia < limite) {
        await this.storage.delete?.(`sala:${id}`)
        delete index[id]
        changed = true
      }
    }
    if (changed) await this.storage.put('salas', index)
  }
}
