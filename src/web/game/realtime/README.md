# Plataforma de tempo real dos jogos

Tudo que é rede de um jogo de simulação autoritativa no host (Tiro na Sala a 40 Hz, Briga na Sala a
60 Hz) mora aqui. O jogo entrega **uma simulação com codec** (`RealtimeSim`) e um **cliente fino**;
o resto é igual para todos.

```
sala (React)  ──useRealtimeSession──▶  session.ts  ──┬─ transport.ts  (canal P2P "game" + repasse game-relay)
                                                     ├─ client.ts      (snapshots, relógio, predição, reconciliação)
                                                     └─ hostRunner.ts ──▶ Worker do jogo ──▶ hostLoop.ts ──▶ RealtimeSim.step
```

| Arquivo | O que faz |
|---|---|
| `types.ts` | `RealtimeSim` (o contrato do jogo), `RealtimeCodec`, mensagens do host (`HostIn`/`HostOut`), view e deps da sessão |
| `transport.ts` | rota por jogador: P2P se o canal abriu e o HELLO ligou peerId a playerId, senão repasse (base64) |
| `hostLoop.ts` | laço do host: fila por jogador, descarte das repetidas, stale, lag por ping, janela de eventos, snapshot cheio, score/result, catch-up |
| `hostRunner.ts` | Worker de módulo ou, se não carregar, a thread principal |
| `hostWorkerEntry.ts` | corpo do Worker (`installHostWorker(sim)`) |
| `client.ts` | `RealtimeClient`: buffer de snapshots, offset do relógio do host, eventos sem repetição, predição, reconciliação, suavização, `interpolation()` |
| `session.ts` | host ou cliente, troca de host por `epoch`, ping, `act` score/result, `relayBatch` |
| `useRealtimeSession.ts` | hook que cria/mantém/atualiza a sessão da partida |

Relógio do host: `tickMs = 1000 / tickHz` em ponto flutuante (briga: 16,67). O acumulador guarda o
resto, não zera, e tem folga de 1e-6 ms, então não deriva nem perde tick. Se o laço atrasar mais de
250 ms ele pula em vez de correr.

## Ligar um jogo novo em 5 passos

Exemplo: Briga na Sala (`src/web/game/brawl/net/`).

1. **Simulação e codec** em `src/shared/games/<jogo>/` (puros, sem DOM): `step`, `clone`, `addPlayer`,
   `setAway`, `scores`, `ranking`, `snapshotFromState`, `restoreState`, `encode*/decode*`. O codec
   usa os mesmos tipos de pacote do tiro (1 HELLO, 2 INPUT, 3 PING, 4 PONG, 5 SNAPSHOT) e
   `MAX_PACKET_BYTES`; é o `shared/games/shooter/codec.ts` como molde.
2. **Binding** `src/web/game/<jogo>/net/realtimeBinding.ts`: declara `interface XTypes extends RealtimeTypes`
   (State, Input, Snapshot, Event, Ref, Score, Statics, Self) e exporta `xSim: RealtimeSim<XTypes>`
   (constantes de tempo, `sanitizeInput`, adaptação da sim e do codec, `selfOf/ackOf/canPredict/predictSelf`
   para a predição). Veja `shooter/net/realtimeBinding.ts`. Briga: `tickHz 60`, `snapshotEvery 2`,
   `interpDelayMs 60`, `inputRedundancy 3`, `relayBatch 3`, `maxLagCompMs 100`; `predictSelf` roda o
   `moveFighter` da sim (a mesma função do `step`) sobre o lutador extraído do snapshot.
3. **Worker** `src/web/game/<jogo>/net/hostWorker.ts` com duas linhas: `installHostWorker(xSim)`.
   E `hostRunner.ts` com o `new Worker(new URL('./hostWorker.ts', import.meta.url), { type: 'module' })`
   LITERAL dentro de `createHostRunner(xSim, spawn, init, out)` (a CSP não aceita `blob:`, e o Vite
   só gera o chunk assim). Cada jogo tem o próprio worker porque a sim dele entra no chunk.
4. **Cliente** `class XClient extends RealtimeClient<XTypes, FrameEvent>`: `localTick(now, controles)`
   chama `this.advanceLocal(now, (seq) => entrada)` (quantiza como o codec), `frame(now, roster)`
   monta o quadro de desenho a partir de `this.interpolation(now)` (os outros) e `this.pred`/`renderPos`
   (você), `setRoster`, e, se precisar, sobrescreve `onEvent`/`afterEvents`/`selfFrom`.
5. **Sessão e hook** `session.ts` do jogo: `RealtimeGameBinding` com `{ sim, createClient, refOf,
   createState(view), idleInput }` e `createXSession = (deps, env = defaultEnv) => createRealtimeSession(binding, deps, env)`,
   onde `defaultEnv = defaultEnv<XTypes>(createHostRunner do jogo)`. Hook: `useRealtimeSession(deps, createXSession, (view) => chaveDaPartida)`.
   A `view` precisa ter `you`, `phase` ('jogando' liga o envio de entradas), `players` (`id, name, slot, bot, present`),
   `hostId` e `epoch`. `act` recebe exatamente `{ type: 'score' | 'result', epoch, scores | ranking }`, igual ao tiro.

## Pontos de atenção

- `predictSelf` e o `step` têm de usar a MESMA função de movimento, e o cliente tem de aplicar a
  entrada quantizada que o host vai ler (como `quantizeInput` no tiro), senão a predição diverge.
- `relayBatch` só vale quando a rota até o host é o repasse; precisa ser `<= inputRedundancy + 1`
  (a redundância cobre os ticks que não foram enviados) e o codec tem de aceitar `inputRedundancy + 1`
  entradas por pacote.
- O Worker recebe o estado por `postMessage` (clone estruturado): o `State` não pode ter funções.
- Mensagens ao coordenador e `game-relay` não mudam: `{ type: 'score'|'result', epoch, ... }` e
  texto base64 de pacotes de até `maxPacketBytes`.
- Testes: `tests/realtime/` tem uma sim de brinquedo a 60 Hz (`toy.ts`) e a rede em memória que serve de molde.
