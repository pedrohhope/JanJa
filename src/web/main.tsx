/// <reference types="vite/client" />
import '@fontsource-variable/archivo/wdth.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { animateFavicon } from './favicon'
import { watchInstall } from './install'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { reloadForUpdate } from './version'
import './styles.css'

// o aviso de "pode instalar" chega cedo: escuta antes de montar a página
watchInstall()
animateFavicon()

// deploy novo com a aba aberta: o Vite avisa quando um pedaço do site não carrega; recarrega uma vez com a versão nova
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForUpdate()) e.preventDefault()
})

const root = createRoot(document.getElementById('root')!)

// Rotas de laboratório (/dev/poker, /dev/audio): só em dev; o ramo some do build de produção, junto com o Pixi.
if (import.meta.env.DEV) {
  void import('./game/dev/routes').then(async ({ DEV_ROUTES }) => {
    const route = DEV_ROUTES.find((r) => r.path === location.pathname)
    if (route) {
      const Page = (await route.load()).default
      root.render(<Page />)
    } else root.render(<App />)
  })
} else {
  // Sem StrictMode de propósito: o duplo mount em dev abriria duas conexões com a sala.
  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  )
}
