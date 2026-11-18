import { z } from 'zod'

/**
 * Tela híbrida: a tela pode passar pelo SFU da Cloudflare (Realtime) em vez de ir P2P.
 * Só a tela (vídeo + áudio da tela) passa pelo SFU; mic, webcam e canais de dados ficam na malha.
 *
 * O cliente nunca fala com a API do Realtime: tudo passa pelo DO da sala, que guarda as credenciais,
 * cria a sessão de cada cliente e checa quem pode assinar o quê.
 * Cada cliente tem no máximo UMA RTCPeerConnection com o SFU, usada para publicar e para assinar.
 * As operações de SDP nessa conexão são feitas em fila pelo cliente, uma de cada vez.
 */

/** rota da tela de quem compartilha */
export const ScreenRouteSchema = z.enum(['mesh', 'sfu'])
export type ScreenRoute = z.infer<typeof ScreenRouteSchema>

/** preferência de quem compartilha (menu de qualidade) */
export const RoutePrefSchema = z.enum(['auto', 'mesh', 'sfu'])
export type RoutePref = z.infer<typeof RoutePrefSchema>

/**
 * Camadas do simulcast. Ordem alfabética = prioridade (o SFU usa `asciibetical`):
 * `a` é a melhor, `c` a mais leve.
 */
export const RIDS = ['a', 'b', 'c'] as const
export const RidSchema = z.enum(RIDS)
export type Rid = z.infer<typeof RidSchema>

/** estado do orçamento do mês (e da sala no dia): economia = sem a camada `a`; esgotado = SFU desligado */
export const BudgetStateSchema = z.enum(['ok', 'economia', 'esgotado'])
export type BudgetState = z.infer<typeof BudgetStateSchema>

export const SdpSchema = z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().min(1).max(60_000) })
export type Sdp = z.infer<typeof SdpSchema>

const RequestIdSchema = z.string().min(1).max(32)
const MidSchema = z.string().min(1).max(16)
const StreamIdSchema = z.string().min(1).max(128)
const KindSchema = z.enum(['audio', 'video'])

/** Mensagens cliente → servidor. Toda mensagem com `requestId` recebe exatamente um `sfu-reply`. */
export const SfuClientMessageSchemas = [
  /**
   * Publica as trilhas da tela (vídeo com simulcast e, se houver, áudio da tela).
   * `sdp` é a oferta da conexão com o SFU; `tracks` liga cada `mid` do SDP à sua trilha.
   * Resposta: `sfu-reply` com `sdp` (answer).
   */
  z.object({
    type: z.literal('sfu-push'),
    requestId: RequestIdSchema,
    streamId: StreamIdSchema,
    sdp: SdpSchema,
    tracks: z.array(z.object({ mid: MidSchema, kind: KindSchema })).min(1).max(2)
  }),
  /**
   * Assina a tela de `from` (que precisa estar no mesmo canal, com `screenRoute: 'sfu'` e `screenStreamId === streamId`).
   * Resposta: `sfu-reply` com `sdp` (offer, que o cliente responde com `sfu-answer`) e `tracks` (mid de cada trilha recebida).
   */
  z.object({
    type: z.literal('sfu-pull'),
    requestId: RequestIdSchema,
    from: z.string().min(1).max(64),
    streamId: StreamIdSchema,
    rid: RidSchema
  }),
  /** answer para uma oferta que veio num `sfu-reply`. Resposta: `sfu-reply` vazio (ou com erro). */
  z.object({ type: z.literal('sfu-answer'), requestId: RequestIdSchema, sdp: SdpSchema }),
  /** troca a camada de uma assinatura de vídeo (mid da conexão de quem assiste). Resposta: `sfu-reply` (pode trazer offer). */
  z.object({ type: z.literal('sfu-layer'), requestId: RequestIdSchema, mid: MidSchema, rid: RidSchema }),
  /**
   * Fecha trilhas desta sessão (publicadas ou assinadas). `sdp` é a oferta já sem essas trilhas
   * (o cliente faz `transceiver.stop()` e `createOffer` antes). Resposta: `sfu-reply` com `sdp` (answer) quando houver.
   */
  z.object({
    type: z.literal('sfu-close'),
    requestId: RequestIdSchema,
    mids: z.array(MidSchema).min(1).max(16),
    sdp: SdpSchema.optional()
  }),
  /** bytes recebidos do SFU desde o último envio (a cada ~30 s e no `pagehide`) */
  z.object({ type: z.literal('sfu-usage'), bytes: z.number().int().min(0).max(50_000_000_000) })
] as const

export const SfuErrorCodeSchema = z.enum(['disabled', 'budget', 'not-allowed', 'api', 'bad-state'])
export type SfuErrorCode = z.infer<typeof SfuErrorCodeSchema>

/** Mensagens servidor → cliente. */
export const SfuServerMessageSchemas = [
  z.object({
    type: z.literal('sfu-reply'),
    requestId: z.string(),
    sdp: SdpSchema.optional(),
    /** trilhas criadas (pull): mid na conexão de quem assiste */
    tracks: z.array(z.object({ mid: z.string(), kind: KindSchema })).optional(),
    error: z.object({ code: SfuErrorCodeSchema, message: z.string() }).optional()
  }),
  /** estado do orçamento (mandado depois do welcome e quando muda) */
  z.object({ type: z.literal('sfu-budget'), state: BudgetStateSchema })
] as const

/** No `welcome`: o SFU está configurado neste deploy? (secrets presentes) */
export const SfuInfoSchema = z.object({ enabled: z.boolean(), budget: BudgetStateSchema })
export type SfuInfo = z.infer<typeof SfuInfoSchema>

/** pior entre dois estados de orçamento */
export function worstBudget(a: BudgetState, b: BudgetState): BudgetState {
  const rank = { ok: 0, economia: 1, esgotado: 2 } as const
  return rank[a] >= rank[b] ? a : b
}

/** camada efetiva que o servidor aceita no estado atual do orçamento */
export function allowedRid(rid: Rid, budget: BudgetState): Rid {
  return budget !== 'ok' && rid === 'a' ? 'b' : rid
}
