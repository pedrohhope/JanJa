import { useEffect, useRef, useState } from 'react'
import type { CoordAction, RealtimeSessionDeps, RealtimeTypes, RealtimeView } from './types'

/** O que o hook precisa da sessão do jogo (qualquer `ManagedRealtimeSession`). */
export interface HookableSession<V> {
  dispose(): void
  update(view: V): void
  setManager(manager: RealtimeSessionDeps<RealtimeView, RealtimeTypes>['manager']): void
}

/**
 * Cria a sessão do jogo quando há partida (`deps` não nulo) e a mantém enquanto for a mesma partida
 * (`matchKey(view)`: por exemplo `createdAt|j` ou `startedAt|e`). Mudança de view/manager só
 * atualiza a sessão; ela não é recriada. `create` é o `createXSession` do jogo (pode ser uma
 * função nova a cada render: o hook guarda a mais recente).
 */
export function useRealtimeSession<V extends RealtimeView, G extends RealtimeTypes, S extends HookableSession<V>>(
  deps: RealtimeSessionDeps<V, G> | null,
  create: (deps: RealtimeSessionDeps<V, G>) => S,
  matchKeyOf: (view: V) => string
): S | null {
  const [session, setSession] = useState<S | null>(null)
  const latest = useRef(deps)
  latest.current = deps
  const createRef = useRef(create)
  createRef.current = create
  const keyRef = useRef(matchKeyOf)
  keyRef.current = matchKeyOf
  const matchKey = deps ? keyRef.current(deps.view) : null

  // cria/descarta ao começar ou acabar a partida
  useEffect(() => {
    const d = latest.current
    if (!matchKey || !d) {
      setSession(null)
      return
    }
    const s = createRef.current({
      view: d.view,
      manager: d.manager,
      relay: (to, data) => latest.current?.relay(to, data),
      onRelay: (cb) => (latest.current ?? d).onRelay(cb),
      act: (a: CoordAction<G>) => latest.current?.act(a)
    })
    setSession(s)
    return () => {
      s.dispose()
      setSession(null)
    }
  }, [matchKey])

  // view e manager novos: só atualiza
  const view = deps?.view
  const manager = deps?.manager
  useEffect(() => {
    if (session && view) session.update(view)
  }, [session, view])
  useEffect(() => {
    if (session) session.setManager(manager)
  }, [session, manager])

  return session
}
