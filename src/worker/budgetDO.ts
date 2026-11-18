import { DurableObject } from 'cloudflare:workers'
import type { BudgetState } from '../shared/sfu'
import { BudgetCore, DEFAULT_MONTHLY_GB, DEFAULT_ROOM_DAILY_GB, parseGb } from './budget'
import type { Env } from './index'

/** Singleton global (`env.BUDGET.getByName('global')`): conta o tráfego do SFU no mês e por sala no dia. */
export class Budget extends DurableObject<Env> {
  private core(): BudgetCore {
    return new BudgetCore(this.ctx.storage, Date.now, {
      monthlyGb: parseGb(this.env.SFU_MONTHLY_GB, DEFAULT_MONTHLY_GB),
      roomDailyGb: parseGb(this.env.SFU_ROOM_DAILY_GB, DEFAULT_ROOM_DAILY_GB)
    })
  }

  report(roomId: string, bytes: number): Promise<BudgetState> {
    return this.core().report(roomId, bytes)
  }

  peek(roomId: string): Promise<BudgetState> {
    return this.core().peek(roomId)
  }
}
