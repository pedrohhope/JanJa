import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * Versões do site. Cada deploy gera arquivos com nomes novos (hash) e apaga os antigos. Quem estava com a aba
 * aberta continua com o index.html velho: ao abrir um jogo, o navegador pede um pedaço (chunk) que não existe
 * mais e o import() falha. Aqui:
 * - `lazyChunk`/`loadChunk`: se um pedaço não carregar, recarrega a página uma vez (já com a versão nova);
 * - `watchVersion`: confere de tempos em tempos se saiu versão nova, para avisar antes de alguém abrir um jogo.
 */

const RELOAD_KEY = 'janja.reloadedAt'
/** não recarrega de novo dentro deste intervalo (evita laço se o problema for outro) */
const RELOAD_GUARD_MS = 60_000

/** Erro de pedaço que não carregou (nomes variam entre Chrome, Firefox e Safari). */
export function isChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return /dynamically imported module|Importing a module script failed|module script|Failed to fetch|error loading dynamically|ChunkLoadError|preload/i.test(
    msg
  )
}

/** Recarrega a página uma vez. Devolve false se já recarregou há pouco (aí quem chamou mostra o erro). */
export function reloadForUpdate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < RELOAD_GUARD_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // sem sessionStorage: recarrega mesmo assim (no pior caso, uma vez por clique)
  }
  location.reload()
  return true
}

/** import() de um pedaço do site; se falhar por versão velha, recarrega a página. */
export function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  return load().catch((err: unknown) => {
    if (isChunkError(err) && reloadForUpdate()) return new Promise<never>(() => undefined) // a página vai recarregar
    throw err
  })
}

/** React.lazy que sobrevive a deploy no meio da sessão. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mesma assinatura do React.lazy
export function lazyChunk<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): LazyExoticComponent<T> {
  return lazy(() => loadChunk(load))
}

/** Script principal desta página (ex.: /assets/index-AbC123.js). */
function entryOf(html: string): string | null {
  return /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1] ?? null
}

function currentEntry(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src]')
  return el ? new URL(el.src, location.href).pathname : null
}

const CHECK_EVERY_MS = 5 * 60_000

/**
 * Chama `onNew` uma vez quando o site publicado for de outra versão que a desta aba.
 * Só em produção (no `vite` de dev o index é outro). Leve: só baixa o index.html, sem passar pelo Worker.
 */
export function watchVersion(onNew: () => void): () => void {
  if (!import.meta.env.PROD) return () => undefined
  const mine = currentEntry()
  if (!mine) return () => undefined
  let done = false
  const check = async () => {
    if (done || document.visibilityState !== 'visible') return
    try {
      const res = await fetch('/', { cache: 'no-store' })
      const theirs = res.ok ? entryOf(await res.text()) : null
      if (theirs && theirs !== mine && !done) {
        done = true
        onNew()
      }
    } catch {
      // sem rede agora: tenta na próxima
    }
  }
  const timer = setInterval(() => void check(), CHECK_EVERY_MS)
  const onVisible = () => void check()
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    done = true
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
