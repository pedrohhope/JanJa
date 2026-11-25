/**
 * Tira os prints dos 12 jogos para a vitrine do painel de jogos.
 *
 *   npm run thumbs                       sobe o `vite` numa porta livre e refaz todos os prints
 *   npm run thumbs -- --only=poker,golf  só esses jogos
 *   npm run thumbs -- --url=http://localhost:5173   usa um `vite` que já está rodando
 *
 * Abre o laboratório de cada jogo (`/dev/<jogo>`) no Chrome headless, leva o jogo até um momento
 * bonito e tira 3 quadros de 1280x720, reduzidos para 640x360 e salvos em `public/game/thumbs/<id>-<n>.webp`.
 * No fim reescreve `src/web/ui/games/thumbs.ts` com o número real de quadros de cada jogo.
 * Chrome: `CHROME_PATH`, ou o Chrome/Edge instalado (Linux, macOS e Windows).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'game', 'thumbs')
const CONTRACT = join(ROOT, 'src', 'web', 'ui', 'games', 'thumbs.ts')
const W = 1280
const H = 720
const OUT_W = 640
const OUT_H = 360
const QUALITY = 0.78
const MAX_KB = 45

type GameId = 'poker' | 'golf' | 'chess' | 'checkers' | 'tycoon' | 'truco' | 'shooter' | 'brawl' | 'naval' | 'mystery' | 'pool' | 'stop' | 'velha' | 'pife'
const ORDER: GameId[] = ['poker', 'golf', 'chess', 'checkers', 'tycoon', 'truco', 'shooter', 'brawl', 'naval', 'mystery', 'pool', 'stop', 'velha', 'pife']

interface Frame {
  /** o que este quadro mostra (vai para o relatório) */
  what: string
  /** rota do laboratório com os parâmetros */
  url: string
  /** leva o jogo até o momento do print; ao voltar, o quadro é tirado */
  run: (page: Page) => Promise<void>
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** `eval` no navegador sem o tsc reclamar do `window` */
const ev = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(async () => { ${fn} })()`) as Promise<T>

const waitFor = (page: Page, expr: string, timeout = 20_000) => page.waitForFunction(expr, { timeout, polling: 100 })

// ---------------------------------------------------------------------------------------------
// o roteiro de cada jogo
// ---------------------------------------------------------------------------------------------

const lab = (page: Page, name: string, call: string) => ev(page, `window.${name}.${call}`)

/** espera o canvas ou o SVG da cena aparecer e o jogo "assentar" (animações de entrada) */
const settle = async (page: Page, ms: number) => {
  await waitFor(page, `document.querySelector('canvas, svg, [data-stage]') !== null`)
  await sleep(ms)
}

const FEN_ITALIANA = 'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 6'
const FEN_SICILIANA = 'r1bq1rk1/pp2ppbp/2np1np1/8/3NP3/2N1BP2/PPPQ2PP/R3KB1R w KQ - 2 9'
const FEN_FINAL = '2r2rk1/pp3ppp/2n1bn2/q2p4/3P4/2N1PN2/PPQ1BPPP/2R2RK1 w - - 4 14'

const golfShot = (map: string, hole: number, overview = false): Frame => ({
  what: `${map}, buraco ${hole}: tacada a caminho do buraco`,
  url: `/dev/golf?map=${map}&hole=${hole}&bots=1`,
  run: async (page) => {
    await settle(page, 3500)
    await ev(
      page,
      `const { MAPS } = await import('/src/shared/games/golf/maps/index.ts')
       const st = window.__golf.state()
       const h = MAPS.find((m) => m.id === st.options.mapId).holes[st.hole]
       let cz = h.rows.findIndex((r) => r.includes('O'))
       const cx = h.rows[cz].indexOf('O') + 0.5
       const b = st.world.balls[0]
       window.__golf.shoot(Math.atan2(cz + 0.5 - b.z, cx - b.x), 0.55)`
    )
    await sleep(700)
    if (overview) await page.keyboard.down('v')
    await sleep(900)
  }
})


/** joga a primeira carta da mão (quando for a vez) */
const clickHand = async (page: Page) => {
  try {
    await waitFor(page, `document.querySelector('.tr-hand.can .tr-hand-card') !== null`, 8000)
    await page.click('.tr-hand.can .tr-hand-card')
  } catch {
    /* sem a vez: o quadro sai assim mesmo */
  }
}

const shooterShot = (map: string, ms: number, weapon: string, bots = 3): Frame => ({
  what: `Tiro na Sala, mapa ${map}, ${bots} robôs, ${weapon}, em plena troca de tiros`,
  url: `/dev/shooter?map=${map}&bots=${bots}&minutes=5&reduced=1`,
  run: async (page) => {
    await waitFor(page, `window.__tiro && window.__tiro.frame() && window.__tiro.sim().phase === 'jogando'`, 30_000)
    await lab(page, '__tiro', 'auto(true)')
    // mantém vida e arma e espera uma troca de tiros com robô perto
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const near = await ev<boolean>(
        page,
        `const t = window.__tiro, s = t.sim(), me = s.players[0]
         if (me.weapon !== '${weapon}') t.give('${weapon}')
         if (me.hp < 60) t.hp(100)
         const alive = s.players.filter((p) => p.slot !== 0 && p.alive)
         const foes = alive.filter((p) => Math.hypot(p.x - me.x, p.y - me.y) < 300)
         if (!foes.length && alive.length && me.alive) {
           const f = alive.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0]
           t.teleport(f.x + 150, f.y + 40)
         }
         return foes.length >= 1 && s.projectiles.length >= 2`
      )
      if (near && Date.now() - t0 > 3500) break
      await sleep(120)
    }
  }
})

const brawlShot = (arena: string, char: string, ms: number, bots = 3): Frame => ({
  what: `Briga na Sala, arena ${arena}, ${char}, ${bots} robôs`,
  url: `/dev/briga?arena=${arena}&char=${char}&bots=${bots}&nivel=dificil&modo=tempo`,
  run: async (page) => {
    await waitFor(page, 'window.__briga && window.__briga.frame()', 30_000)
    await sleep(ms)
  }
})

/** tiros na batalha naval: derruba um navio inteiro do bot e erra alguns */
const navalShot = (variant: number): Frame => ({
  what: `batalha naval, variante ${variant + 1}`,
  url: '/dev/naval',
  run: async (page) => {
    await settle(page, 800)
    await page.waitForSelector('.nv-dock button:not(.primary)')
    await lab(page, '__naval', 'ready()')
    await waitFor(page, `window.__naval.state().phase === 'batalha'`)
    await sleep(800)
    const shoot = async (x: number, y: number) => {
      await waitFor(page, `window.__naval.state().turn === 0`, 15_000)
      const box = (await (await page.$('.nv-enemy svg'))!.boundingBox())!
      const k = box.width / (7 + 10 * 8)
      await page.mouse.click(box.x + (7 + x * 8 + 4) * k, box.y + (7 + y * 8 + 4) * k)
      await sleep(700)
    }
    const cells = (await ev(
      page,
      `const { shipCells } = await import('/src/shared/games/naval/fleet.ts')
       return window.__naval.state().fleets[1].map((p) => shipCells(p))`
    )) as Array<Array<{ x: number; y: number }>>
    const ships = [...cells].sort((a, b) => a.length - b.length)
    const plan = [
      [ships[0], ships[1].slice(0, 1)],
      [ships[0], ships[2], ships[3].slice(0, 2)],
      [ships[2], ships[3], ships[4].slice(0, 2), ships[0]]
    ][variant]
    for (const group of plan) for (const c of group) await shoot(c.x, c.y)
    // alguns tiros na água
    for (const [x, y] of [[0, 0], [9, 9], [0, 9]].slice(0, variant + 1)) {
      const taken = cells.some((sh) => sh.some((c) => c.x === x && c.y === y))
      if (!taken) await shoot(x, y)
    }
    await sleep(2500)
  }
})

/** marca algumas casas do caderno de pistas */
const markNotes = async (page: Page, n: number) => {
  await page.evaluate((count: number) => {
    const marks = [...document.querySelectorAll<HTMLButtonElement>('.my-mark:not(.auto)')]
    marks.filter((_, i) => i % 3 === 0).slice(0, count).forEach((m) => m.click())
  }, n)
}

/** escolhe quem, onde e com o quê no palpite (um botão de cada linha) */
const pickGuess = async (page: Page) => {
  await page.evaluate(() => {
    document.querySelectorAll('.my-pick-row').forEach((row, i) => {
      const bs = row.querySelectorAll<HTMLButtonElement>('button')
      bs[(i + 1) % Math.max(1, bs.length)]?.click()
    })
  })
}

/** passa o mouse sobre a mesa para aparecer a linha de mira */
const aimAt = async (page: Page, fx: number, fy: number) => {
  const box = (await (await page.$('canvas'))!.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5)
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 6 })
  await sleep(400)
}

/** faz uma tacada no estado do laboratório (na direção da bola mais perto) */
const poolShot = async (page: Page, power: number) => {
  await ev(
    page,
    `const { apply, autoShot } = await import('/src/shared/games/pool/engine.ts')
     const s = window.__sinuca.state()
     const a = { ...autoShot(s), power: ${power} }
     const rng = { int: (m) => Math.floor(Math.random() * m) }
     const r = apply(s, s.players[s.turn].playerId, a, { now: Date.now(), rng })
     if (!r.error) window.__sinuca.set(r.state)`
  )
}

/** respostas de verdade, por letra, na ordem das categorias do Stop (nome, CEP, animal, cor, fruta, objeto, comida, sogra) */
const STOP_WORDS: Record<string, string[]> = {
  A: ['Ana', 'Amazonas', 'Arara', 'Azul', 'Abacaxi', 'Abajur', 'Arroz', 'Animada'],
  B: ['Bia', 'Bahia', 'Baleia', 'Bege', 'Banana', 'Bola', 'Bolo', 'Brava'],
  C: ['Carlos', 'Ceará', 'Cavalo', 'Cinza', 'Caju', 'Cadeira', 'Churrasco', 'Chata'],
  M: ['Marcos', 'Maranhão', 'Macaco', 'Marrom', 'Manga', 'Mesa', 'Macarrão', 'Mandona'],
  P: ['Paulo', 'Paraná', 'Pato', 'Preto', 'Pera', 'Panela', 'Pizza', 'Paciente']
}

/** recarrega até sair uma letra que tem respostas no banco */
const stopLetter = async (page: Page): Promise<string> => {
  for (let i = 0; i < 25; i++) {
    await page.waitForSelector('.sp-letter')
    const letter = await page.$eval('.sp-letter', (e) => (e.textContent ?? '').trim().slice(0, 1))
    if (STOP_WORDS[letter]) return letter
    await page.reload({ waitUntil: 'load' })
    await page.addStyleTag({ content: CLEAN_CSS })
  }
  throw new Error('nenhuma letra boa no sorteio')
}

/** digita as respostas nos campos do Stop (as primeiras `count`) */
const typeAnswers = async (page: Page, count: number) => {
  const letter = await stopLetter(page)
  const inputs = await page.$$('.sp-field input')
  for (const [i, input] of inputs.entries()) {
    if (i >= count) break
    await input.click()
    await input.type(STOP_WORDS[letter][i] ?? '', { delay: 15 })
  }
}

const PLANS: Record<GameId, Frame[]> = {
  poker: [
    {
      what: 'mesa de 6, cartas distribuídas e apostas',
      url: '/dev/poker?size=1280x720&tv=0&n=6&reduced=1',
      run: async (page) => {
        await settle(page, 1500)
        await lab(page, '__lab', 'newHand()')
        await sleep(600)
        await lab(page, '__lab', "act('call')")
        await lab(page, '__lab', "act('raise')")
        await sleep(2000)
      }
    },
    {
      what: 'flop na mesa',
      url: '/dev/poker?size=1280x720&tv=0&n=5&reduced=1',
      run: async (page) => {
        await settle(page, 1500)
        await lab(page, '__lab', 'newHand()')
        await sleep(500)
        await lab(page, '__lab', "act('call')")
        await lab(page, '__lab', 'flop()')
        await sleep(2500)
      }
    },
    {
      what: 'showdown com o pote',
      url: '/dev/poker?size=1280x720&tv=0&n=6&reduced=1',
      run: async (page) => {
        await settle(page, 1500)
        await lab(page, '__lab', 'newHand()')
        await sleep(400)
        await lab(page, '__lab', 'flop()')
        await lab(page, '__lab', 'turn()')
        await lab(page, '__lab', 'river()')
        await lab(page, '__lab', 'showdown()')
        await sleep(2500)
      }
    }
  ],
  golf: [golfShot('quintal', 2), golfShot('montanha', 3, true), golfShot('fliperama', 3)],
  chess: [FEN_ITALIANA, FEN_SICILIANA, FEN_FINAL].map((fen, i) => ({
    what: `xadrez, posição ${i + 1} de meio de partida`,
    url: `/dev/chess?bot=0&min=10&fen=${encodeURIComponent(fen)}`,
    run: (page: Page) => settle(page, 1200)
  })),
  checkers: [
    '.b.b.b.b/b.b...b./.b...b.b/..b...w./.w.w.w../w...w.w./...w...w/w.w...w. w',
    '.b...b.b/b.b...../......../..b.b.b./.w.W..../w.b.w.w./.w...w.w/w.w...w. w',
    '...b.b../b.....b./.....B.b/..b...w./.w.....w/....w.w./.w.....w/w...W... w'
  ].map((pos, i) => ({
    what: `damas, posição ${i + 1}`,
    url: `/dev/checkers?bot=0&min=10&pos=${encodeURIComponent(pos)}`,
    run: (page: Page) => settle(page, 1200)
  })),
  tycoon: [0, 1, 2].map((i) => ({
    what: `Magnata, tabuleiro com casas compradas (${i + 1})`,
    url: '/dev/tycoon?bots=3&min=15&seed=' + (i + 1),
    run: async (page: Page) => {
      await settle(page, 1500)
      const sets = [
        [[1, 'eu', 1], [2, 'eu', 2], [5, 'bot1', 3], [6, 'bot1', 1], [9, 'bot2', 2], [4, 'eu', 0], [11, 'bot3', 0], [13, 'bot3', 3], [14, 'bot3', 1], [18, 'bot2', 1], [21, 'eu', 2], [22, 'eu', 1], [26, 'bot1', 0], [29, 'bot2', 4], [30, 'bot2', 2]],
        [[1, 'bot1', 2], [2, 'bot1', 3], [5, 'eu', 4], [6, 'eu', 2], [7, 'eu', 1], [9, 'bot3', 1], [10, 'bot3', 0], [13, 'bot2', 2], [15, 'bot2', 3], [17, 'eu', 0], [18, 'bot1', 2], [21, 'bot3', 3], [23, 'bot3', 1], [25, 'bot2', 2], [29, 'eu', 1], [31, 'eu', 3]],
        [[10, 'eu', 3], [9, 'eu', 2], [11, 'bot1', 0], [4, 'bot1', 0], [19, 'bot1', 0], [14, 'bot2', 4], [13, 'bot2', 4], [15, 'bot2', 2], [22, 'bot3', 3], [23, 'bot3', 3], [30, 'eu', 2], [31, 'eu', 3], [1, 'bot3', 1]]
      ][i]
      for (const [t, o, l] of sets) await lab(page, '__magnata', `give(${t}, '${o}', ${l})`)
      const pos = [[3, 12, 19, 26], [7, 15, 20, 28], [10, 17, 24, 5]][i]
      for (const [k, id] of ['eu', 'bot1', 'bot2', 'bot3'].entries()) await lab(page, '__magnata', `place(${pos[k]}, '${id}')`)
      await sleep(1200)
    }
  })),
  truco: [
    {
      what: 'truco 1x1, placar 12 a 9, primeira vaza na mesa',
      url: '/dev/truco?n=2',
      run: async (page) => {
        await settle(page, 1000)
        await lab(page, '__truco', "hands([['1e','7e','3c'], ['1b','6o','5c']])")
        await lab(page, '__truco', 'score(12, 9)')
        await sleep(1500)
        await clickHand(page)
        await sleep(2500)
      }
    },
    {
      what: 'truco 2x2, três cartas jogadas',
      url: '/dev/truco?n=4',
      run: async (page) => {
        await settle(page, 1000)
        await lab(page, '__truco', "hands([['3e','7o','4c'], ['2b','5o','6c'], ['1b','4e','3o'], ['7c','2o','5e']])")
        await lab(page, '__truco', 'score(8, 14)')
        await sleep(1500)
        await clickHand(page)
        await sleep(4500)
      }
    },
    {
      what: 'truco 3x3, mesa cheia',
      url: '/dev/truco?n=6',
      run: async (page) => {
        await settle(page, 1000)
        await lab(page, '__truco', "score(20, 17)")
        await sleep(1500)
        await clickHand(page)
        await sleep(6000)
      }
    }
  ],
  shooter: [
    shooterShot('quintal', 8000, 'sub'),
    shooterShot('casa', 9000, 'escopeta'),
    shooterShot('quintal', 14000, 'rifle', 4)
  ],
  brawl: [
    brawlShot('estante', 'jan', 7000),
    brawlShot('telhado', 'janja', 9000),
    brawlShot('estante', 'teve', 12000, 4)
  ],
  naval: [
    navalShot(0),
    navalShot(1),
    navalShot(2)
  ],
  mystery: [
    {
      what: 'Mistério, o tabuleiro do Casarão com os dados rolados',
      url: '/dev/mystery?n=4',
      run: async (page) => {
        await settle(page, 1500)
        await markNotes(page, 5)
        await ev(page, `window.__misterio.mine()`)
        await sleep(400)
        await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.my-turnbox button')].find((b) => b.textContent?.includes('Rolar'))?.click())
        await sleep(900)
      }
    },
    {
      what: 'Mistério, palpites dos outros na mesa',
      url: '/dev/mystery?n=5',
      run: async (page) => {
        await settle(page, 1000)
        await sleep(9000)
        await markNotes(page, 9)
        await sleep(500)
      }
    },
    {
      what: 'Mistério, montando o seu palpite',
      url: '/dev/mystery?n=3',
      run: async (page) => {
        await settle(page, 1000)
        await sleep(6000)
        await ev(page, `window.__misterio.enter('biblioteca')`)
        await sleep(400)
        await pickGuess(page)
        await page.evaluate(() => document.querySelector('.my-pick')?.scrollIntoView({ block: 'end' }))
        await sleep(600)
      }
    }
  ],
  pool: [
    {
      what: 'sinuca, mesa armada com a linha de mira',
      url: '/dev/pool?bot=0',
      run: async (page) => {
        await settle(page, 1500)
        const box = (await (await page.$('canvas'))!.boundingBox())!
        await page.mouse.click(box.x + box.width * 0.24, box.y + box.height * 0.5)
        await sleep(500)
        await aimAt(page, 0.66, 0.47)
      }
    },
    {
      what: 'sinuca, depois da quebra, bolas espalhadas',
      url: '/dev/pool?bot=0',
      run: async (page) => {
        await settle(page, 1200)
        await poolShot(page, 1)
        await sleep(6500)
        await aimAt(page, 0.3, 0.55)
      }
    },
    {
      what: 'sinuca, segunda tacada com a linha de mira',
      url: '/dev/pool?bot=0',
      run: async (page) => {
        await settle(page, 1200)
        await poolShot(page, 1)
        await sleep(6500)
        await poolShot(page, 0.7)
        await sleep(5500)
        await aimAt(page, 0.7, 0.4)
      }
    }
  ],
  stop: [
    {
      what: 'Stop, letra sorteada e respostas sendo escritas',
      url: '/dev/stop?n=4&s=60',
      run: async (page) => {
        await settle(page, 1500)
        await typeAnswers(page, 3)
        await sleep(2500)
      }
    },
    {
      what: 'Stop, quase tudo preenchido',
      url: '/dev/stop?n=3&s=60',
      run: async (page) => {
        await settle(page, 1500)
        await typeAnswers(page, 99)
        await sleep(4000)
      }
    },
    {
      what: 'Stop, conferência das respostas',
      url: '/dev/stop?n=4&s=60',
      run: async (page) => {
        await settle(page, 1200)
        await typeAnswers(page, 99)
        await sleep(300)
        await page.evaluate(() => {
          document.querySelector<HTMLButtonElement>('.sp-stop')?.click()
        })
        await sleep(6000)
      }
    }
  ],
  velha: [
    {
      what: 'Velha ao quadrado, começo da partida',
      url: '/dev/velha?bot=0&min=10&seed=3',
      run: async (page) => {
        await settle(page, 800)
        await lab(page, '__velha', 'random(9)')
        await sleep(500)
      }
    },
    {
      what: 'Velha ao quadrado, tabuleiros pequenos já ganhos',
      url: '/dev/velha?bot=0&min=10&seed=5',
      run: async (page) => {
        await settle(page, 800)
        await lab(page, '__velha', 'random(34)')
        await sleep(500)
      }
    },
    {
      what: 'Velha ao quadrado, reta final',
      url: '/dev/velha?bot=0&min=5&seed=8',
      run: async (page) => {
        await settle(page, 800)
        await ev(page, `for (let i = 0; i < 80; i++) { const s = window.__velha.state(); if (s.result || s.pos.small.filter((x) => x !== null).length >= 5) break; window.__velha.random(1) }`)
        await sleep(500)
      }
    }
  ],
  pife: [
    {
      what: 'pife, mesa de 4 com a sua mão organizada',
      url: '/dev/pife?n=4&seed=4&bot=0',
      run: async (page) => {
        await settle(page, 800)
        await page.keyboard.press('o')
        await sleep(500)
      }
    },
    {
      what: 'pife, mesa cheia de 8 no meio da rodada',
      url: '/dev/pife?n=8&seed=11&bot=0',
      run: async (page) => {
        await settle(page, 800)
        await lab(page, '__pife', 'auto(14)')
        await sleep(300)
        await page.keyboard.press('o')
        await sleep(500)
      }
    },
    {
      what: 'pife, alguém bateu e as mãos aparecem',
      url: '/dev/pife?n=5&seed=4&bot=0',
      run: async (page) => {
        await settle(page, 800)
        await lab(page, '__pife', 'auto(400)')
        await sleep(800)
      }
    }
  ]
}

// ---------------------------------------------------------------------------------------------
// infraestrutura
// ---------------------------------------------------------------------------------------------

/** esconde a barra de depuração do laboratório (a primeira div dentro da raiz) e o que não é jogo */
const CLEAN_CSS = `
  #root > div > div:first-child:not([data-lab-stage]) { display: none !important; }
  [data-lab-fps], .briga-hints { display: none !important; }
  * { cursor: none !important; }
  ::-webkit-scrollbar { display: none; }
`

function chromePath(): string {
  const env = process.env.CHROME_PATH
  if (env && existsSync(env)) return env
  const pf = process.env.PROGRAMFILES ?? 'C:\\Program Files'
  const pf86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'
  const local = process.env.LOCALAPPDATA ?? ''
  const list = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ]
  const found = list.find((p) => p && existsSync(p))
  if (!found) throw new Error('Não achei o Chrome. Defina CHROME_PATH com o caminho do chrome.exe (ou do Edge).')
  return found
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

async function startVite(): Promise<{ url: string; stop: () => void }> {
  const port = await freePort()
  const bin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  const child: ChildProcess = spawn(process.execPath, [bin, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' })
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url)).ok) return { url, stop: () => child.kill() }
    } catch {
      /* ainda subindo */
    }
    await sleep(200)
  }
  child.kill()
  throw new Error('O vite não subiu.')
}

/** reduz o PNG 1280x720 para 640x360 e codifica em WebP, tudo dentro do próprio Chrome (sem dependência nativa) */
async function toWebp(tool: Page, png: Buffer): Promise<Buffer> {
  const b64 = await tool.evaluate(
    async (data: string, w: number, h: number, q: number) => {
      const img = new Image()
      img.src = `data:image/png;base64,${data}`
      await img.decode()
      // reduz em dois passos para ficar mais nítido
      let src: CanvasImageSource = img
      let sw = img.width
      let sh = img.height
      while (sw / 2 >= w) {
        const c = document.createElement('canvas')
        c.width = sw = Math.round(sw / 2)
        c.height = sh = Math.round(sh / 2)
        const g = c.getContext('2d')!
        g.imageSmoothingQuality = 'high'
        g.drawImage(src, 0, 0, sw, sh)
        src = c
      }
      const out = document.createElement('canvas')
      out.width = w
      out.height = h
      const g = out.getContext('2d')!
      g.imageSmoothingQuality = 'high'
      g.drawImage(src, 0, 0, w, h)
      const blob: Blob = await new Promise((res) => out.toBlob((b) => res(b!), 'image/webp', q))
      const buf = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return btoa(s)
    },
    Buffer.from(png).toString('base64'),
    OUT_W,
    OUT_H,
    QUALITY
  )
  return Buffer.from(b64, 'base64')
}

async function openFrame(browser: Browser, base: string, frame: Frame): Promise<Page> {
  const page = await browser.newPage()
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('janja.debug.renderer', 'canvas')
    localStorage.setItem('janja.tour.done', '1')
  })
  page.on('pageerror', (e) => console.warn('    [erro na página]', String(e).slice(0, 200)))
  await page.goto(base + frame.url, { waitUntil: 'load' })
  await page.addStyleTag({ content: CLEAN_CSS })
  await page.evaluate(() => document.fonts.ready)
  return page
}

function writeContract(counts: Record<string, number>): void {
  const src = `/**
 * Prints de cada jogo para a vitrine do painel de jogos.
 * GERADO por \`npm run thumbs\` (scripts/build-thumbs.ts): abre o laboratório de cada jogo no Chrome
 * headless e tira alguns quadros. Não edite à mão; rode o script de novo quando o visual mudar.
 * Os arquivos ficam em public/game/thumbs/ (WebP, 640×360). A vitrine troca os quadros como um
 * "canal" de TV; com "reduzir movimento" fica só o primeiro.
 */
import type { GameId } from '../../../shared/games/protocol'

export const THUMB_W = ${OUT_W}
export const THUMB_H = ${OUT_H}

const frames = (id: GameId, n: number): readonly string[] => Array.from({ length: n }, (_, i) => \`/game/thumbs/\${id}-\${i + 1}.webp\`)

export const THUMBS: Record<GameId, readonly string[]> = {
${ORDER.map((id) => `  ${id}: frames('${id}', ${counts[id]})`).join(',\n')}
}
`
  writeFileSync(CONTRACT, src)
}

function currentCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const id of ORDER) counts[id] = existsSync(OUT) ? readdirSync(OUT).filter((f) => new RegExp(`^${id}-\\d+\\.webp$`).test(f)).length : 0
  return counts
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
  const only = arg('only')?.split(',') as GameId[] | undefined
  const ids = ORDER.filter((id) => !only || only.includes(id))
  mkdirSync(OUT, { recursive: true })

  const given = arg('url')
  const vite = given ? { url: given.replace(/\/$/, ''), stop: () => undefined } : await startVite()
  console.log(`vite em ${vite.url}`)
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: [
      '--no-sandbox',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--hide-scrollbars',
      '--mute-audio',
      `--window-size=${W},${H}`
    ]
  })
  const tool = await browser.newPage()
  const failed: string[] = []
  try {
    for (const id of ids) {
      const plan = PLANS[id]
      for (const f of readdirSync(OUT)) if (new RegExp(`^${id}-\\d+\\.webp$`).test(f)) rmSync(join(OUT, f))
      let n = 0
      for (const frame of plan) {
        const page = await openFrame(browser, vite.url, frame)
        try {
          await frame.run(page)
          const png = (await page.screenshot({ type: 'png' })) as Buffer
          const webp = await toWebp(tool, png)
          n++
          writeFileSync(join(OUT, `${id}-${n}.webp`), webp)
          const kb = webp.length / 1024
          console.log(`${id}-${n}.webp  ${kb.toFixed(1)} KB  ${frame.what}${kb > MAX_KB ? '  (acima de ' + MAX_KB + ' KB!)' : ''}`)
        } catch (e) {
          failed.push(`${id}: ${frame.what}`)
          console.error(`${id}: falhou em "${frame.what}":`, e instanceof Error ? e.message : e)
        } finally {
          await page.close()
        }
      }
    }
  } finally {
    await browser.close()
    vite.stop()
  }
  writeContract(currentCounts())
  if (failed.length) {
    console.error(`\nFalharam ${failed.length} quadro(s):\n  ${failed.join('\n  ')}`)
    process.exitCode = 1
  }
}

void main()
