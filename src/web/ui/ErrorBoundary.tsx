import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isChunkError } from '../version'

interface State {
  error: unknown
}

/**
 * Última rede de segurança: um erro na renderização vira uma tela com "Recarregar" em vez da página em branco.
 * O caso comum é versão nova publicada com a aba aberta (os pedaços antigos do site somem no deploy).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[janja] erro na tela', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    const update = isChunkError(this.state.error)
    return (
      <main className="center">
        <div className="wait">
          <h1>{update ? 'Saiu uma versão nova do JanJa' : 'Algo deu errado nesta tela'}</h1>
          <p className="muted">
            {update ? 'Recarregue a página para continuar. Você volta para a mesma sala.' : 'Recarregue a página. Se continuar, avise quem cuida do JanJa.'}
          </p>
          <div className="modal-actions">
            <button className="primary" onClick={() => location.reload()}>
              Recarregar
            </button>
          </div>
        </div>
      </main>
    )
  }
}
