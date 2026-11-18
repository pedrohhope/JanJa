import { useSyncExternalStore } from 'react'
import { watchInputDevice, type InputInfo } from './inputDevice'

/** um único watcher para todos os componentes: liga com o primeiro e desliga com o último */
let state: InputInfo = { device: 'teclado', family: 'xbox' }
const subs = new Set<() => void>()
let stop: (() => void) | null = null

function subscribe(fn: () => void): () => void {
  subs.add(fn)
  if (!stop) {
    stop = watchInputDevice((info) => {
      state = info
      for (const s of [...subs]) s()
    })
  }
  return () => {
    subs.delete(fn)
    if (subs.size === 0 && stop) {
      stop()
      stop = null
    }
  }
}

const snapshot = (): InputInfo => state
const serverSnapshot = (): InputInfo => ({ device: 'teclado', family: 'xbox' })
const fixedServer: InputInfo = serverSnapshot()

/** dispositivo de entrada atual e a família do controle (para trocar dicas de botão) */
export function useInputDevice(): InputInfo {
  return useSyncExternalStore(subscribe, snapshot, () => fixedServer)
}
