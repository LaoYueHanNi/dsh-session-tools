/**
 * Session tools for DeepSeek Harness: list visible Sessions, hand one message
 * to another Session, or move separate work into a new Session.
 *
 * Delivery goes through the Session controller's `prompt` method, so it reuses
 * the same admission path as the Web client: durable inbox append, request
 * deduplication by `requestId`, and explicit resume of a cold Session.
 *
 * @module dsh-session-tools
 */

import { stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.tools declaration merge into this program.
import type {} from '@deepseek-ai/dsh-tools'
// Type-only: pulls the ctx.sessionController declaration merge into this program.
import type {} from '@deepseek-ai/dsh-api-session-controller'
// Type-only: pulls the ctx.sessionQuery declaration merge into this program.
import type {} from '@deepseek-ai/dsh-session-query'
// Type-only: pulls the ctx.agents and ctx.sessions declaration merges into this program.
import type {} from '@deepseek-ai/dsh-agent'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
// Type-only: pulls the ctx.workspaceRegistry declaration merge into this program.
import type {} from '@deepseek-ai/dsh-workspace'
// Type-only: pulls the ctx.sessionProjections declaration merge into this program.
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: pulls the ctx.sessionTitle declaration merge into this program.
import type {} from '@deepseek-ai/dsh-session-title'

export const name = 'session-tools'

export const inject = ['tools', 'sessionController', 'sessionQuery', 'sessions', 'agents']

/** Rows returned when the caller does not ask for a size. */
const DEFAULT_LIMIT = 20

/** Largest page a single `session_list` call may return. */
const MAX_LIMIT = 50

/** Ambiguous or missing targets report at most this many candidates. */
const MAX_CANDIDATES = 5

/** Message rows a `session_read` call returns when the caller names no size. */
const DEFAULT_READ_LIMIT = 20

/** Largest message page a single `session_read` call may return. */
const MAX_READ_LIMIT = 50

/** Longest single message text echoed back to the reading model. */
const MAX_MESSAGE_CHARS = 4000

/** Model rows an unavailable-route error lists before it is cut. */
const MAX_CATALOG_ROWS = 40

/** Preset rows a roster error lists before it is cut. */
const MAX_PRESET_ROWS = 20

/** Roles a read may project; the surface also carries system, developer, and tool rows. */
const READ_ROLES = ['user', 'assistant'] as const

type ReadRole = (typeof READ_ROLES)[number]

const LIST_DESCRIPTION = [
  'List Sessions this Session may message.',
  'Returns sessionId, title, working directory, creation time, and whether the target is archived or a delegated subagent.',
  'Use it to resolve a conversation the user names in prose before calling session_send.',
].join(' ')

const MODELS_DESCRIPTION = [
  'List the model routes this Host can run in a new Session: provider id, model id, display name, supported reasoning efforts, and the current default selection.',
  'Call it before session_create names a provider, model, or reasoning effort you are not sure about — including whenever the user names a model informally ("glm5.3", "minimax m3.1f", "go 的 v4.1flash"): match what they said against the display names and ids here instead of searching configuration files.',
  'These are Host-wide routes for new Sessions; subagent model selection is a separate surface with its own restrictions.',
].join(' ')

const PRESETS_DESCRIPTION = [
  'List the Agent presets this Host can run in a new Session: preset id, display name, description, the default mark, and any activation failure.',
  'Call it before session_create names an agentPreset you are not sure about — including whenever the user refers to a preset informally ("the coding preset", "用那个写代码的预设"): match what they said against the names and descriptions here instead of guessing an id.',
  'An empty roster means this deployment composes no Agent presets; omit agentPreset then.',
].join(' ')

const SEND_DESCRIPTION = [
  'Send one message to another Session and let it run on its own.',
  'The message enters that Session as a user message and may start a new turn there, so delivery is not execution confirmation.',
  'One-way by default. Set reply to true when you need the result: the delivered text then tells the target how to send its answer back to you.',
  'Never read or poll the target afterwards. A delivered message ends your part whether or not it answers. An answer reaches you the same way, as a message from another Session, so there is nothing to watch for.',
  'When the prompt opens with a target marker the user picked in the composer — `[目标会话：<title>]` on a Chinese interface, `[Target session: <title>]` on an English one — that Session is the target and the rest of the prompt is an INSTRUCTION about what to send: compose the message yourself (including asking for a report when the user wants one) instead of forwarding the instruction verbatim. A marker naming an untitled Session carries its sessionId instead of a title, which you may pass to target directly.',
  'Pass target as a Session id or an exact Session title; an ambiguous title is rejected with candidates to choose from.',
].join(' ')

const CREATE_DESCRIPTION = [
  'Create a new Session in a directory this Host knows, then hand it its first message.',
  'Call it whenever the user wants work started, opened, or moved into a separate conversation, including when they name the place informally ("the alpha project", "that checkout from yesterday") instead of spelling a path.',
  'cwd accepts an absolute path, a path relative to the calling Session directory, or the name of a directory this Host already knows as a Workspace or a Session working directory, including a Session title the user referred to. A name matching several directories is rejected with candidates instead of guessed.',
  'message is required: a Session that never received an event stays blank and never appears in the sidebar, so every creation carries the task that Session starts with. For an empty conversation, the user creates one with the sidebar button.',
  'Pass provider and model together when the user names a model for the new Session ("open one with glm5.3"): call session_models first to resolve what they said against the exact provider and model ids. An unavailable route fails before anything is created, with the full model catalog attached so you can retry with the exact id. reasoningEffort is optional and must be one the model supports; when omitted, the Session reuses the effort you last selected manually for the same model (the Host default selection), else the model provider\'s recommended default effort.',
  'agentPreset optionally names the Agent preset the new Session runs: pass the exact id, or the name the user called the preset by ("the coding preset"). A name is matched against the roster\'s display names, several matches list the candidates, and a miss fails with the full roster attached before anything is created; call session_presets to see the ids and names first. Omit to use the configured default preset.',
  'The new Session joins the Workspace registered at its directory.',
  'Set reply to true when the new Session should send its result back to you when it finishes.',
].join(' ')

const READ_DESCRIPTION = [
  'Read the recent messages of one Session, only when the user explicitly asks to see what that Session said.',
  'Never call it to follow up on your own session_send and never poll another Session: once a message is delivered your task is over, whether or not the target has replied.',
  'Pass target as a Session id or an exact Session title; an ambiguous title is rejected with candidates to choose from.',
  'Returns only user and assistant rows that carry text, so tool calls and results are summarized away.',
].join(' ')

/** The Session header facts these tools read, structurally typed. */
interface SessionHeaderLike {
  readonly id: string
  readonly createdAt: number
  readonly cwd?: string
  readonly origin?: 'subagent'
}

/** One listed logical Session, reduced to the header these tools need. */
interface SessionRecordLike {
  readonly header: SessionHeaderLike
}

/** One projected row in `session_list` output. */
interface SessionRow {
  readonly sessionId: string
  readonly title: string
  readonly createdAt: number
  readonly cwd?: string
  readonly archived?: boolean
  readonly delegated?: boolean
}

/** One durable Workspace, reduced to the directory and title this plugin reads. */
interface WorkspaceLike {
  readonly id?: string
  readonly path: string
  readonly title?: string
}

/** Directory-owning Workspace registry, as this plugin consumes it. */
interface WorkspaceRegistryLike {
  create(cwd: string): Promise<{ readonly id: string }>
  readonly archivedSessionIds?: readonly string[]
  list?(): readonly WorkspaceLike[]
  resolveByPath?(path: string): Promise<unknown>
}

/** One requested model route, exactly as the caller spelled it. */
interface ModelRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** One declared Agent preset, reduced to the display facts this plugin reads. */
interface PresetLike {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly broken?: string
}

/** Preset registry as this plugin consumes it: the roster and the default id. */
interface AgentPresetsLike {
  readonly defaultId: string
  list(): Promise<readonly PresetLike[]>
}

/** One directory this Host already knows by name: a Workspace or a Session directory. */
interface KnownDirectory {
  readonly path: string
  readonly title?: string
}

/** Projection reader used to answer display titles. */
interface ProjectionsLike {
  snapshot(session: unknown, keys: readonly string[]): { readonly values?: ProjectionValues } | undefined
}

/** Durable projection cache reader for cold Sessions. */
interface ProjectionCacheLike {
  cachedSnapshot(header: unknown, keys: readonly string[]): { readonly values?: ProjectionValues } | undefined
}

/** The projection keys a display title is answered from. */
interface ProjectionValues {
  readonly title?: unknown
  readonly subagent?: unknown
}

/** A tool execution fact surface: cancellation, call identity, and calling Agent. */
interface ExecLike {
  readonly signal: AbortSignal
  readonly callId: string
  readonly agent?: {
    readonly session?: {
      readonly id: string
      readonly header?: SessionHeaderLike
    }
  }
}

/** Sender identity plus whether a report was requested. */
interface HandoffOptions {
  readonly senderId?: string
  readonly senderTitle?: string
  readonly reply: boolean
}

/** Delivery inputs shared by `session_send` and `session_create`. */
interface DeliveryOptions {
  readonly senderId?: string
  readonly senderTitle?: string
  readonly mode: 'queue' | 'steer'
  readonly requestId: string
}

type Resolution =
  | { readonly kind: 'found'; readonly record: SessionRecordLike }
  | { readonly kind: 'self' }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly SessionRecordLike[] }
  | { readonly kind: 'missing'; readonly candidates: readonly SessionRecordLike[] }

/**
 * Register all four tools for the lifetime of the plugin fiber.
 * @param ctx - Host context.
 */
export function apply(ctx: Context): void {
  ctx.tools.register({
    name: 'session_list',
    description: LIST_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Case-insensitive text matched against Session titles, ids, and working directories. Omit to list the most recent Sessions.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `Maximum number of rows to return; defaults to ${DEFAULT_LIMIT}.`,
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          sessions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sessionId: { type: 'string' },
                title: { type: 'string' },
                cwd: { type: 'string' },
                createdAt: { type: 'integer' },
                archived: { type: 'boolean' },
                delegated: { type: 'boolean' },
              },
              required: ['sessionId', 'title', 'createdAt'],
              additionalProperties: false,
            },
          },
          total: { type: 'integer' },
          shown: { type: 'integer' },
        },
        required: ['sessions', 'total', 'shown'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: '列出可发消息的会话', kind: 'read' }),
    async execute(args, exec) {
      const input = args as { query?: unknown, limit?: unknown }
      const requested = input.limit === undefined ? DEFAULT_LIMIT : Number(input.limit)
      const limit = Number.isSafeInteger(requested) && requested > 0
        ? Math.min(requested, MAX_LIMIT)
        : DEFAULT_LIMIT
      const query = (typeof input.query === 'string' ? input.query : '').trim().toLowerCase()
      const rows = await collectSessions(ctx, exec as ExecLike, query)
      return {
        sessions: rows.slice(0, limit),
        total: rows.length,
        shown: Math.min(rows.length, limit),
      }
    },
  })

  ctx.tools.register({
    name: 'session_models',
    description: MODELS_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          default: {
            type: 'object',
            properties: {
              provider: { type: 'string' },
              model: { type: 'string' },
              reasoningEffort: { type: 'string' },
            },
            required: ['provider', 'model'],
            additionalProperties: false,
          },
          models: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                provider: { type: 'string' },
                model: { type: 'string' },
                name: { type: 'string' },
                efforts: { type: 'array', items: { type: 'string' } },
                defaultEffort: { type: 'string' },
              },
              required: ['provider', 'model'],
              additionalProperties: false,
            },
          },
          total: { type: 'integer' },
        },
        required: ['default', 'models', 'total'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: '查看可用模型', kind: 'read' }),
    async execute() {
      let catalog: Awaited<ReturnType<Context['sessionController']['modelCatalog']>>
      try {
        catalog = await ctx.sessionController.modelCatalog()
      } catch (error: unknown) {
        throw new Error(`session_models cannot read the model catalog: ${error instanceof Error ? error.message : String(error)}`)
      }
      const models: {
        provider: string
        model: string
        name?: string
        efforts?: string[]
        defaultEffort?: string
      }[] = []
      for (const group of catalog.groups) {
        for (const entry of group.models) {
          const efforts = entry.reasoning?.efforts ?? []
          const defaultEffort = entry.reasoning?.defaultEffort
          models.push({
            provider: group.id,
            model: entry.id,
            ...(typeof entry.name === 'string' && entry.name !== '' ? { name: entry.name } : {}),
            ...(efforts.length > 0
              ? {
                efforts: efforts.map(candidate => candidate.id),
                ...(typeof defaultEffort === 'string' ? { defaultEffort } : {}),
              }
              : {}),
          })
        }
      }
      return {
        default: {
          provider: catalog.default.provider,
          model: catalog.default.model,
          ...(catalog.default.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: catalog.default.reasoningEffort as string }),
        },
        models,
        total: models.length,
      }
    },
  })

  ctx.tools.register({
    name: 'session_presets',
    description: PRESETS_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          presets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' },
                isDefault: { type: 'boolean' },
                broken: { type: 'string' },
              },
              required: ['id'],
              additionalProperties: false,
            },
          },
          total: { type: 'integer' },
        },
        required: ['presets', 'total'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: '查看可用预设', kind: 'read' }),
    async execute() {
      const presets = ctx.get('agentPresets') as AgentPresetsLike | undefined
      if (presets === undefined) return { presets: [], total: 0 }
      const roster = await presetRoster(presets)
      const rows = roster.map(preset => ({
        id: preset.id,
        ...(preset.name === undefined ? {} : { name: preset.name }),
        ...(preset.description === undefined ? {} : { description: preset.description }),
        ...(preset.id === presets.defaultId ? { isDefault: true } : {}),
        ...(preset.broken === undefined ? {} : { broken: preset.broken }),
      }))
      return { presets: rows, total: rows.length }
    },
  })

  ctx.tools.register({
    name: 'session_send',
    description: SEND_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Session id or exact Session title. An ambiguous title returns candidates instead of guessing.',
        },
        message: {
          type: 'string',
          description: 'Message text delivered to the target Session as a user message.',
        },
        mode: {
          type: 'string',
          enum: ['queue', 'steer'],
          description: 'queue (default) appends the message after the target Session finishes its current work; steer interrupts its running turn.',
        },
        reply: {
          type: 'boolean',
          description: 'Ask the target to send its result back to the calling Session when it finishes. Off by default, which makes the message one-way.',
        },
      },
      required: ['target', 'message'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          title: { type: 'string' },
          mode: { type: 'string' },
          delivery: { type: 'string', enum: ['relay', 'user'] },
          accepted: { type: 'boolean' },
        },
        required: ['sessionId', 'title', 'mode', 'delivery', 'accepted'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    presentCall: args => ({
      card: 'generic',
      title: '向另一个会话发送消息',
      kind: 'other',
      rawInput: typeof (args as { target?: unknown })?.target === 'string'
        ? (args as { target: string }).target
        : undefined,
    }),
    presentResult: (args, result) => result.isError ? undefined : {
      card: 'generic',
      title: `已向「${String((args as { target?: unknown })?.target)}」发送消息`,
      content: [{ type: 'text', text: String((args as { message?: unknown })?.message) }],
    },
    async execute(args, exec) {
      const input = args as { target?: unknown, message?: unknown, mode?: unknown, reply?: unknown }
      const target = typeof input.target === 'string' ? input.target.trim() : ''
      const message = typeof input.message === 'string' ? input.message.trim() : ''
      if (target === '') throw new Error('session_send requires a non-empty target')
      if (message === '') throw new Error('session_send requires a non-empty message')
      if (input.mode !== undefined && input.mode !== 'queue' && input.mode !== 'steer') {
        throw new Error('session_send mode must be "queue" or "steer"')
      }

      const facts = exec as ExecLike
      const records = await ctx.sessionQuery.listSessions(facts.signal) as readonly SessionRecordLike[]
      const archived = archivedSessionIds(ctx)
      const labels = projectedTitles(ctx, records)
      const self = facts.agent?.session?.id
      if (self === target) {
        throw new Error('session_send cannot target the Session that is calling it')
      }
      const resolution = resolveTarget(records, labels, target, self)

      if (resolution.kind === 'self') {
        throw new Error('session_send cannot target the Session that is calling it')
      }
      if (resolution.kind === 'missing') {
        throw new Error(`No Session matches target "${target}". Call session_list to find the Session id or exact title.`)
      }
      if (resolution.kind === 'ambiguous') {
        throw new Error(
          `Target "${target}" matches ${resolution.candidates.length} Sessions: `
          + `${renderCandidates(resolution.candidates, labels)}. `
          + 'Call session_send again with one sessionId.',
        )
      }

      const { header } = resolution.record
      const title = labels.get(header.id) ?? header.id
      if (header.origin === 'subagent') {
        throw new Error(
          `Session "${title}" is a delegated subagent Session; use send_message with its agent name instead`,
        )
      }
      if (archived.has(header.id)) {
        throw new Error(`Session "${title}" is archived; restore it in the Web client before sending`)
      }

      const mode = (input.mode ?? 'queue') as 'queue' | 'steer'
      const senderId = facts.agent?.session?.id
      const senderTitle = senderId === undefined ? undefined : labels.get(senderId) ?? senderId
      const body = withHandoffEnvelope(message, {
        ...(senderId === undefined ? {} : { senderId }),
        ...(senderTitle === undefined ? {} : { senderTitle }),
        reply: input.reply === true,
      })
      const delivery = await deliverToSession(ctx, facts, header.id, body, {
        ...(senderId === undefined ? {} : { senderId }),
        ...(senderTitle === undefined ? {} : { senderTitle }),
        mode,
        requestId: `session-send:${facts.callId}:${header.id}`,
      })
      return { sessionId: header.id, title, mode, delivery, accepted: true }
    },
  })

  ctx.tools.register({
    name: 'session_create',
    description: CREATE_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'Directory the new Session owns. An absolute path, a path relative to the calling Session directory, or the name of a Workspace / Session directory or Session title the user referred to ("alpha"). Omit to reuse the calling Session directory.',
        },
        title: {
          type: 'string',
          description: 'Session title shown in the sidebar. Omit to keep the generated title.',
        },
        message: {
          type: 'string',
          description: 'First message delivered to the new Session as a handoff, so it starts with the task. Required: a Session that never received an event stays blank and never appears in the sidebar.',
        },
        agentPreset: {
          type: 'string',
          description: 'Agent preset for the new Session: an exact preset id, or the name the user called the preset by. A miss fails with the preset roster attached. Omit to use the configured default.',
        },
        provider: {
          type: 'string',
          description: 'Provider route for the model the new Session runs, e.g. "remote-magpie/zhipu". Pass together with model when the user names a model; the route is validated against the model catalog before anything is created.',
        },
        model: {
          type: 'string',
          description: 'Exact model id under provider, e.g. "glm-5.3". Resolve the name the user said to this id yourself; an unavailable route fails with the full catalog attached for the retry.',
        },
        reasoningEffort: {
          type: 'string',
          description: 'Optional reasoning effort; omit to reuse the effort last selected manually for the same model, else the model provider\'s recommended default.',
        },
        reply: {
          type: 'boolean',
          description: 'Ask the new Session to send its result back to the calling Session when it finishes. Off by default.',
        },
      },
      required: ['message'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          title: { type: 'string' },
          cwd: { type: 'string' },
          model: {
            type: 'string',
            description: 'Selected model route as "provider/model" (plus " @ effort" when one was given), when the caller named a model.',
          },
          preset: {
            type: 'string',
            description: 'Preset id the new Session runs, when the caller named a preset; a spoken name is reported as its resolved id.',
          },
          delivered: { type: 'boolean' },
        },
        required: ['sessionId', 'delivered'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    presentCall: args => ({
      card: 'generic',
      title: '创建会话',
      kind: 'other',
      rawInput: typeof (args as { cwd?: unknown })?.cwd === 'string'
        ? (args as { cwd: string }).cwd
        : undefined,
    }),
    presentResult: (args, result) => result.isError ? undefined : {
      card: 'generic',
      title: `已创建会话「${typeof (args as { title?: unknown })?.title === 'string'
        ? (args as { title: string }).title
        : '新会话'}」`,
      ...typeof (args as { message?: unknown })?.message === 'string'
        ? { content: [{ type: 'text' as const, text: (args as { message: string }).message }] }
        : {},
    },
    async execute(args, exec) {
      const input = args as {
        cwd?: unknown
        title?: unknown
        message?: unknown
        agentPreset?: unknown
        provider?: unknown
        model?: unknown
        reasoningEffort?: unknown
        reply?: unknown
      }
      const facts = exec as ExecLike
      // A blank Session carries no event, so the sidebar lists no row for it
      // and the user cannot reach it. Every creation therefore hands over the
      // first task instead of leaving an empty shell behind.
      const message = typeof input.message === 'string' ? input.message.trim() : ''
      if (message === '') {
        throw new Error(
          'session_create requires a non-empty message: a Session that never received an event stays blank '
          + 'and never appears in the sidebar. Hand the new Session its first task, '
          + 'or create the empty conversation with the sidebar button.',
        )
      }
      // A named model is validated against the live catalog before the Session
      // exists: a miss must cost nothing, and the retry must carry the ids.
      // An omitted effort is completed from what the Host already knows —
      // the user's last manual selection for this very model, else the
      // provider's recommended default — so the Session never lands on an
      // unspecified "default" effort when better knowledge exists.
      const namedRoute = requestedModelRoute(input)
      const route = namedRoute === undefined ? undefined : await resolveModelRoute(ctx, namedRoute)
      // A named preset is resolved against the live roster under the same
      // miss-costs-nothing rule: before the Session exists, and against the
      // display names users actually say, so "the coding preset" lands on its
      // preset without the calling model guessing a slug id.
      const requestedPreset = typeof input.agentPreset === 'string' ? input.agentPreset.trim() : ''
      const agentPreset = requestedPreset === '' ? undefined : await resolveAgentPreset(ctx, requestedPreset)
      // Omitted cwd inherits the calling Session's directory. Passing nothing
      // through would let the controller fall back to the profile directory,
      // which puts the new Session in the wrong workspace (or none at all).
      const requested = typeof input.cwd === 'string' ? input.cwd.trim() : ''
      const cwd = requested !== ''
        ? await resolveCreateDirectory(ctx, facts, requested)
        : facts.agent?.session?.header?.cwd
      // Register the directory as a Workspace before creating the Session, so
      // the new Session joins that Workspace and appears in the sidebar. A
      // Session created with a bare `cwd` belongs to no Workspace and stays
      // outside every grouped list.
      const registry = ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
      let workspaceId: string | undefined
      if (cwd !== undefined && registry !== undefined) {
        try {
          workspaceId = (await registry.create(cwd)).id
        } catch {
          // A path that is not a directory falls back to the plain cwd branch.
          workspaceId = undefined
        }
      }
      const created = await ctx.sessionController.create({
        ...(workspaceId === undefined ? (cwd === undefined ? {} : { cwd }) : { workspaceId: workspaceId as never }),
        ...(agentPreset === undefined ? {} : { agentPreset }),
      })
      const agent = ctx.agents.get(created.sessionId)
      // The selection is recorded before the first message is delivered, so the
      // handoff's opening model turn already runs on the requested route, and
      // it appends only this Session's `model/selection` event — never the
      // Host-wide default the GUI selector saves alongside a manual switch.
      if (route !== undefined) {
        if (agent === undefined) {
          throw new Error(
            `session_create found no live Agent for the new Session "${created.sessionId}", `
            + 'so its model selection cannot be applied; nothing was delivered',
          )
        }
        agent.model.select(route.reasoningEffort === undefined
          ? { provider: route.provider, model: route.model }
          : {
            provider: route.provider,
            model: route.model,
            reasoningEffort: route.reasoningEffort as Exclude<ModelSelection['reasoningEffort'], undefined>,
          })
      }
      const title = typeof input.title === 'string' && input.title.trim() !== ''
        ? input.title.trim()
        : undefined
      if (title !== undefined && agent !== undefined) {
        try {
          ctx.get('sessionTitle')?.rename(agent.session, title)
        } catch {
          // Naming is best-effort; the Session exists either way.
        }
      }

      const records = await ctx.sessionQuery.listSessions(facts.signal) as readonly SessionRecordLike[]
      const labels = projectedTitles(ctx, records)
      const senderId = facts.agent?.session?.id
      const senderTitle = senderId === undefined ? undefined : labels.get(senderId) ?? senderId
      const body = withHandoffEnvelope(message, {
        ...(senderId === undefined ? {} : { senderId }),
        ...(senderTitle === undefined ? {} : { senderTitle }),
        reply: input.reply === true,
      })
      await deliverToSession(ctx, facts, created.sessionId, body, {
        ...(senderId === undefined ? {} : { senderId }),
        ...(senderTitle === undefined ? {} : { senderTitle }),
        mode: 'queue',
        requestId: `session-create:${facts.callId}:${created.sessionId}`,
      })

      return {
        sessionId: created.sessionId,
        ...(title === undefined ? {} : { title }),
        ...(cwd === undefined ? {} : { cwd }),
        ...(route === undefined ? {} : { model: describeModelRoute(route) }),
        ...(agentPreset === undefined ? {} : { preset: agentPreset }),
        delivered: true,
      }
    },
  })

  ctx.tools.register({
    name: 'session_read',
    description: READ_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Session id or exact Session title. An ambiguous title returns candidates instead of guessing.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_READ_LIMIT,
          description: `Maximum number of messages to return, newest last; defaults to ${DEFAULT_READ_LIMIT}.`,
        },
        roles: {
          type: 'array',
          items: { type: 'string', enum: READ_ROLES },
          description: 'Roles to include; defaults to both user and assistant.',
        },
      },
      required: ['target'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          title: { type: 'string' },
          total: { type: 'integer' },
          shown: { type: 'integer' },
          truncated: { type: 'boolean' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                seq: { type: 'integer' },
                role: { type: 'string' },
                time: { type: 'integer' },
                text: { type: 'string' },
              },
              required: ['seq', 'role', 'time', 'text'],
              additionalProperties: false,
            },
          },
        },
        required: ['sessionId', 'title', 'total', 'shown', 'truncated', 'messages'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({
      card: 'generic',
      title: '读取另一个会话的消息',
      kind: 'read',
      rawInput: typeof (args as { target?: unknown })?.target === 'string'
        ? (args as { target: string }).target
        : undefined,
    }),
    presentResult: (args, result) => result.isError ? undefined : {
      card: 'generic',
      title: typeof (args as { target?: unknown })?.target === 'string'
        ? `已读取「${(args as { target: string }).target}」的消息`
        : '已读取会话消息',
    },
    async execute(args, exec) {
      const input = args as { target?: unknown, limit?: unknown, roles?: unknown }
      const facts = exec as ExecLike
      const target = typeof input.target === 'string' ? input.target.trim() : ''
      if (target === '') throw new Error('session_read requires a non-empty target')
      const requested = input.limit === undefined ? DEFAULT_READ_LIMIT : Number(input.limit)
      const limit = Number.isSafeInteger(requested) && requested > 0
        ? Math.min(requested, MAX_READ_LIMIT)
        : DEFAULT_READ_LIMIT
      const roles = requestedRoles(input.roles)

      const records = await ctx.sessionQuery.listSessions(facts.signal) as readonly SessionRecordLike[]
      const labels = projectedTitles(ctx, records)
      // Reading the calling Session is legitimate, so self is not excluded here.
      const resolution = resolveTarget(records, labels, target, undefined)
      if (resolution.kind === 'missing') {
        throw new Error(`No Session matches target "${target}". Call session_list to find the Session id or exact title.`)
      }
      if (resolution.kind === 'ambiguous') {
        throw new Error(
          `Target "${target}" matches ${resolution.candidates.length} Sessions: `
          + `${renderCandidates(resolution.candidates, labels)}. `
          + 'Call session_read again with one sessionId.',
        )
      }
      if (resolution.kind === 'self') {
        throw new Error('session_read resolved the calling Session; pass its id or exact title instead')
      }

      const { header } = resolution.record
      const title = labels.get(header.id) ?? header.id
      let surface
      try {
        surface = await ctx.sessionQuery.readSurface(header.id as never)
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`Cannot read Session "${title}": ${reason}`)
      }

      const messages: { seq: number, role: ReadRole, time: number, text: string }[] = []
      for (const event of surface?.events ?? []) {
        const role = messageRole(event)
        if (role === undefined || !roles.includes(role)) continue
        const text = eventText(event)
        if (text === '') continue
        messages.push({ seq: event.seq, role, time: event.time, text: clipText(text) })
      }
      const window = messages.slice(-limit)
      return {
        sessionId: header.id,
        title,
        total: messages.length,
        shown: window.length,
        truncated: messages.length > window.length,
        messages: window,
      }
    },
  })
}

/**
 * Read the model route the caller requested, if any.
 * @param input - raw tool arguments.
 * @returns the route, or undefined when no model was named.
 * @throws when only half a route (provider or model alone) was supplied.
 */
function requestedModelRoute(input: { provider?: unknown, model?: unknown, reasoningEffort?: unknown }): ModelRoute | undefined {
  const provider = typeof input.provider === 'string' ? input.provider.trim() : ''
  const model = typeof input.model === 'string' ? input.model.trim() : ''
  const effort = typeof input.reasoningEffort === 'string' ? input.reasoningEffort.trim() : ''
  if (provider === '' && model === '' && effort === '') return undefined
  if (provider === '' || model === '') {
    throw new Error('session_create takes provider and model together; pass both, or neither to use the default model')
  }
  return {
    provider,
    model,
    ...(effort === '' ? {} : { reasoningEffort: effort }),
  }
}

/**
 * Validate a requested model route against the live model catalog, before the
 * Session exists, and complete an omitted reasoning effort.
 *
 * The catalog is the same source the GUI model picker renders, and its groups
 * already exclude providers without a currently available model, so a hit is
 * routable. A miss fails with the whole catalog attached, because the calling
 * model — not this plugin — is the one that resolves what the user said.
 *
 * Effort completion: the Host keeps exactly one default selection — the
 * provider/model/effort triple of the user's last manual switch. When its
 * route matches the requested one, its effort IS the effort the user last
 * chose for this model, so it is reused. Otherwise the provider-declared
 * recommended default effort applies. With neither available, the effort
 * stays omitted and the first model request follows the adapter default.
 * Both sources were validated when they were recorded, so no re-check runs.
 * @param ctx - Host context.
 * @param route - caller-requested provider and model.
 * @returns the route to record, with the effort completed when known.
 */
async function resolveModelRoute(ctx: Context, route: ModelRoute): Promise<ModelRoute> {
  let catalog: Awaited<ReturnType<Context['sessionController']['modelCatalog']>>
  try {
    catalog = await ctx.sessionController.modelCatalog()
  } catch (error: unknown) {
    throw new Error(`session_create cannot read the model catalog: ${error instanceof Error ? error.message : String(error)}`)
  }
  const group = catalog.groups.find(candidate => candidate.id === route.provider)
  const entry = group?.models.find(candidate => candidate.id === route.model)
  if (group === undefined || entry === undefined) {
    throw new Error(
      `model "${route.provider}/${route.model}" is not in the model catalog. `
      + renderModelCatalog(catalog),
    )
  }
  const efforts = entry.reasoning?.efforts
  if (route.reasoningEffort !== undefined && efforts !== undefined
    && !efforts.some(candidate => candidate.id === route.reasoningEffort)) {
    throw new Error(
      `reasoning effort "${route.reasoningEffort}" is not supported by "${route.provider}/${route.model}". `
      + `Supported efforts: ${efforts.map(candidate => candidate.id).join(', ')}.`,
    )
  }
  if (route.reasoningEffort !== undefined) return route
  const fromDefault = catalog.default.provider === route.provider && catalog.default.model === route.model
    ? catalog.default.reasoningEffort
    : undefined
  const effort = fromDefault ?? entry.reasoning?.defaultEffort
  return effort === undefined ? route : { ...route, reasoningEffort: effort }
}

/**
 * Render the model catalog as one retry-ready list.
 *
 * Model ids may themselves contain slashes (e.g.
 * `remote-magpie/minimax-cn/MiniMax-M3.1-Flash` under provider
 * `magpie-anthropic`), so a bare `provider/model` join is ambiguous — the
 * caller cannot tell where one segment ends. Each row therefore labels the
 * two fields explicitly.
 * @param catalog - live Host model catalog.
 * @returns a sentence with up to {@link MAX_CATALOG_ROWS} labelled rows.
 */
function renderModelCatalog(catalog: {
  readonly default: { readonly provider: string, readonly model: string, readonly reasoningEffort?: string }
  readonly groups: readonly {
    readonly id: string
    readonly models: readonly { readonly id: string }[]
  }[]
}): string {
  const rows: string[] = []
  for (const group of catalog.groups) {
    for (const model of group.models) rows.push(`provider=${group.id} model=${model.id}`)
  }
  const shown = rows.slice(0, MAX_CATALOG_ROWS)
  const effort = catalog.default.reasoningEffort
  return `Default: provider=${catalog.default.provider} model=${catalog.default.model}${effort === undefined ? '' : ` @ ${effort}`}. `
    + `Available: ${shown.join('; ')}${rows.length > shown.length ? '; …' : ''}. `
    + 'Call session_create again with an exact provider and model id; session_models lists this catalog with reasoning efforts.'
}

/**
 * One-line label of the applied model route for the tool result.
 * @param route - the route that was recorded.
 * @returns `provider/model`, plus ` @ effort` when one was given.
 */
function describeModelRoute(route: ModelRoute): string {
  return `${route.provider}/${route.model}${route.reasoningEffort === undefined ? '' : ` @ ${route.reasoningEffort}`}`
}

/**
 * Resolve a requested Agent preset id or spoken name against the live roster,
 * before the Session exists.
 *
 * Unlike a model id, a preset id is a declared slug the user never says out
 * loud — what users name is the roster's display name ("the coding preset").
 * The exact id therefore wins first; a name is then matched, in normalized
 * form, against each usable preset's name and id, exact before partial. Every
 * ambiguous or missing outcome names the roster, because the calling model —
 * not this plugin — is the one that heard what the user actually said.
 *
 * A preset whose activation failed is never chosen by name (matching it would
 * only dead-end), but naming its exact id reports why it cannot run.
 * @param ctx - Host context.
 * @param requested - caller-supplied preset id or spoken name.
 * @returns the preset id the new Session runs.
 */
async function resolveAgentPreset(ctx: Context, requested: string): Promise<string> {
  const presets = ctx.get('agentPresets') as AgentPresetsLike | undefined
  if (presets === undefined) {
    throw new Error(
      'this deployment composes no Agent preset roster, so session_create cannot run a named preset. '
      + 'Omit agentPreset to use the default composition.',
    )
  }
  const roster = await presetRoster(presets)
  const exact = roster.find(preset => preset.id === requested)
  if (exact !== undefined) {
    if (exact.broken !== undefined) {
      throw new Error(`agent preset "${requested}" is currently unavailable: ${exact.broken}`)
    }
    return exact.id
  }
  const wanted = nameKey(requested)
  if (wanted !== '') {
    const usable = roster.filter(preset => preset.broken === undefined)
    for (const partial of [false, true]) {
      const candidates = presetMatches(usable, wanted, partial)
      const only = candidates[0]
      if (candidates.length === 1 && only !== undefined) return only.id
      if (candidates.length > 1) {
        throw new Error(
          `agent preset "${requested}" matches ${candidates.length} presets: ${renderPresetCandidates(candidates)}. `
          + 'Call session_create again with one preset id.',
        )
      }
    }
  }
  throw new Error(
    `agent preset "${requested}" is not in the preset roster. ${renderPresetRoster(roster, presets.defaultId)}`,
  )
}

/**
 * Read the preset roster, wrapping a registry failure as a tool error.
 * @param presets - preset registry service.
 * @returns roster rows in registry order.
 */
async function presetRoster(presets: AgentPresetsLike): Promise<readonly PresetLike[]> {
  try {
    return await presets.list()
  } catch (error: unknown) {
    throw new Error(`cannot read the preset roster: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Which usable presets answer to a normalized spoken name.
 * @param presets - presets without an activation failure.
 * @param wanted - normalized name the caller supplied.
 * @param partial - whether containment counts, or only an exact key.
 * @returns the matching presets, in roster order.
 */
function presetMatches(presets: readonly PresetLike[], wanted: string, partial: boolean): readonly PresetLike[] {
  return presets.filter(preset => {
    const name = nameKey(preset.name ?? '')
    const id = nameKey(preset.id)
    return partial
      ? name.includes(wanted) || id.includes(wanted)
      : name === wanted || id === wanted
  })
}

/**
 * Render candidate rows for an error that asks the model to disambiguate.
 * @param candidates - matching presets.
 * @returns comma-separated `id (name)` entries.
 */
function renderPresetCandidates(candidates: readonly PresetLike[]): string {
  return candidates
    .slice(0, MAX_CANDIDATES)
    .map(preset => `${preset.id}${preset.name === undefined ? '' : ` (${preset.name})`}`)
    .join(', ')
}

/**
 * Render the preset roster as one retry-ready list, default first.
 * @param roster - every declared preset, including broken ones.
 * @param defaultId - preset a request without a preset would run.
 * @returns a sentence with up to {@link MAX_PRESET_ROWS} labelled rows.
 */
function renderPresetRoster(roster: readonly PresetLike[], defaultId: string): string {
  const rows = roster.map(preset =>
    `id=${preset.id}${preset.name === undefined ? '' : ` name=${preset.name}`}`
    + `${preset.id === defaultId ? ' (default)' : ''}${preset.broken === undefined ? '' : ' (broken)'}`)
  return `Default: ${defaultId}. `
    + `Available: ${rows.slice(0, MAX_PRESET_ROWS).join('; ')}${rows.length > MAX_PRESET_ROWS ? '; …' : ''}. `
    + 'Call session_create again with an exact preset id; session_presets lists this roster with descriptions.'
}

/**
 * Resolve a directory argument against the calling Session.
 * @param exec - tool execution facts.
 * @param value - absolute or relative directory.
 * @returns resolved directory path.
 */
function resolveDirectory(exec: ExecLike, value: string): string {
  if (/^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('/') || value.startsWith('\\\\')) return value
  const base = exec.agent?.session?.header?.cwd
  return base === undefined ? value : `${base.replace(/[\\/]+$/u, '')}/${value}`
}

/**
 * Resolve the `cwd` argument of `session_create` to a directory that exists.
 *
 * Users rarely spell a path: they say "the alpha project" or "that
 * checkout from yesterday". An argument that names an existing directory wins
 * outright. Otherwise it is matched against the directories this Host already
 * knows — registered Workspaces and listed Session working directories — so a
 * spoken name lands where the sidebar shows it. Several matches are reported as
 * candidates rather than guessed, and a definite miss names the known
 * directories so the calling model can retry instead of inventing a path.
 * @param ctx - Host context.
 * @param exec - tool execution facts.
 * @param requested - caller-supplied directory or name.
 * @returns an existing absolute directory.
 */
async function resolveCreateDirectory(ctx: Context, exec: ExecLike, requested: string): Promise<string> {
  const direct = resolveDirectory(exec, requested)
  if (await directoryExists(ctx, direct)) return direct

  const known = await knownDirectories(ctx, exec)
  const paths: string[] = []
  for (const entry of known) {
    if (!directoryMatches(entry, requested)) continue
    if (!paths.includes(entry.path)) paths.push(entry.path)
  }

  if (paths.length > 1) {
    throw new Error(
      `Session directory "${requested}" matches ${paths.length} known directories: ${paths.join(', ')}. `
      + 'Call session_create again with one full path.',
    )
  }
  const only = paths[0]
  if (only !== undefined && await directoryExists(ctx, only)) return only

  const inherited = exec.agent?.session?.header?.cwd
  throw new Error(
    `Session directory "${requested}" is neither an existing directory nor a known Workspace or Session directory. `
    + `${describeKnownDirectories(known, requested)} `
    + (inherited === undefined
      ? 'Call session_create again with an absolute path.'
      : `Omit cwd to use the calling Session directory (${inherited}), or pass an absolute path.`),
  )
}

/**
 * Whether a path currently names a directory.
 *
 * The Workspace registry answers without touching the filesystem layout this
 * plugin does not own; a profile without that service falls back to `stat`.
 * @param ctx - Host context.
 * @param path - candidate directory.
 * @returns whether the directory exists.
 */
async function directoryExists(ctx: Context, path: string): Promise<boolean> {
  const registry = ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
  if (typeof registry?.resolveByPath === 'function') {
    try {
      await registry.resolveByPath(path)
      return true
    } catch {
      return false
    }
  }
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * The directories this Host can name: registered Workspaces, then the working
 * directory of every listed Session.
 * @param ctx - Host context.
 * @param exec - tool execution facts.
 * @returns known directories in Workspace order, then Session order.
 */
async function knownDirectories(ctx: Context, exec: ExecLike): Promise<readonly KnownDirectory[]> {
  const known: KnownDirectory[] = []
  const registry = ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
  if (typeof registry?.list === 'function') {
    try {
      for (const workspace of registry.list()) {
        if (typeof workspace?.path !== 'string' || workspace.path === '') continue
        known.push({
          path: workspace.path,
          ...(typeof workspace.title === 'string' && workspace.title !== '' ? { title: workspace.title } : {}),
        })
      }
    } catch {
      // An unavailable registry leaves only the Session directories below.
    }
  }
  const records = await ctx.sessionQuery.listSessions(exec.signal) as readonly SessionRecordLike[]
  const labels = projectedTitles(ctx, records)
  for (const record of records) {
    const cwd = record.header.cwd
    if (cwd === undefined || cwd === '') continue
    const title = labels.get(record.header.id)
    known.push({ path: cwd, ...(title === undefined ? {} : { title }) })
  }
  return known
}

/**
 * Whether one known directory answers to a spoken name.
 * The Workspace title, the directory's own last segment, and a multi-segment
 * suffix all count; separators and case are normalized away so
 * `alpha`, `Alpha Work`, and `dsh/alpha` name the same place.
 * @param entry - known directory.
 * @param requested - caller-supplied name.
 * @returns whether the name selects this directory.
 */
function directoryMatches(entry: KnownDirectory, requested: string): boolean {
  const wanted = nameKey(requested)
  if (wanted === '') return false
  const last = entry.path.split(/[\\/]+/u).filter(segment => segment !== '').at(-1)
  if (entry.title !== undefined && nameKey(entry.title) === wanted) return true
  if (last !== undefined && nameKey(last) === wanted) return true
  const suffix = pathKey(entry.path)
  const wantedSuffix = pathKey(requested)
  return suffix === wantedSuffix || suffix.endsWith(`/${wantedSuffix}`)
}

/**
 * Comparison key for one path segment or a Chinese/English directory name.
 * @param value - raw name.
 * @returns lowercased name without separators or padding punctuation.
 */
function nameKey(value: string): string {
  return value.toLowerCase().replace(/[\s_\-]+/gu, '')
}

/**
 * Comparison key for a whole directory path, keeping segment boundaries.
 * @param value - raw path.
 * @returns lowercased, separator-normalized path.
 */
function pathKey(value: string): string {
  return value.split(/[\\/]+/u).filter(segment => segment !== '').map(nameKey).join('/')
}

/**
 * Name the directories a failed resolution could have meant, closest first.
 * @param known - known directories.
 * @param requested - caller-supplied name.
 * @returns one sentence listing at most {@link MAX_CANDIDATES} paths.
 */
function describeKnownDirectories(known: readonly KnownDirectory[], requested: string): string {
  const paths: string[] = []
  for (const entry of known) if (!paths.includes(entry.path)) paths.push(entry.path)
  if (paths.length === 0) return 'No Workspace or Session directory is known yet.'
  const wanted = nameKey(requested)
  const related = paths.filter(path => wanted !== '' && nameKey(path).includes(wanted))
  const shown = (related.length > 0 ? related : paths).slice(0, MAX_CANDIDATES)
  return `Known directories: ${shown.join(', ')}${paths.length > shown.length ? ', …' : ''}.`
}

/**
 * Wrap one relayed message with the sending Session's identity, and with the
 * exact way to answer when the caller asked for a report.
 *
 * The identity prefix is the return address: without it a receiving model has
 * nowhere to send its answer, and the only alternative left would be for the
 * sender to read that Session, which this plugin deliberately never requires.
 * @param message - caller-supplied body.
 * @param options - sender identity and whether a report was requested.
 * @returns model-facing body.
 */
function withHandoffEnvelope(message: string, options: HandoffOptions): string {
  if (options.senderId === undefined || options.senderTitle === undefined) return message
  const head = `[来自会话「${options.senderTitle}」(${options.senderId})]`
  if (!options.reply) return `${head}\n\n${message}`
  return [
    head,
    '',
    message,
    '',
    `[回报方式：完成后用 session_send 把结果发给「${options.senderTitle}」(${options.senderId})。发完即结束，不要等待或轮询。]`,
  ].join('\n')
}

/**
 * Deliver one message to the target Session.
 *
 * A live Agent receives it through its inbox with a `session-handoff` source,
 * which lets the Client decorate the row with the sending Session. A cold
 * Session has no live Agent to address, so the message falls back to the
 * Session controller's prompt path with an ordinary user source.
 * @param ctx - Host context.
 * @param exec - tool execution facts.
 * @param targetSessionId - Session that receives the message.
 * @param body - model-facing text to deliver.
 * @param options - sender identity, delivery mode, and prompt request id.
 * @returns which source the delivered message carries.
 */
async function deliverToSession(
  ctx: Context,
  exec: ExecLike,
  targetSessionId: string,
  body: string,
  options: DeliveryOptions,
): Promise<'relay' | 'user'> {
  const live = ctx.agents.get(targetSessionId as never)
  if (live !== undefined) {
    const message = {
      id: globalThis.crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: body }],
      source: {
        kind: 'session-handoff',
        form: 'relay',
        ...(options.senderId === undefined ? {} : { senderSessionId: options.senderId }),
        ...(options.senderTitle === undefined ? {} : { senderTitle: options.senderTitle }),
      },
    }
    if (options.mode === 'steer') live.steer(message as never)
    else live.followup(message as never)
    const flushed = await ctx.sessions.flush(live.session)
    if (!flushed) throw new Error('Session persistence did not acknowledge the delivered message')
    return 'relay'
  }

  await ctx.sessionController.prompt({
    requestId: options.requestId as never,
    sessionId: targetSessionId as never,
    mode: options.mode,
    content: [{ type: 'text', text: body }],
  }, exec.signal)
  return 'user'
}

/**
 * Project the Sessions this caller may address, without the calling Session.
 * @param ctx - Host context.
 * @param exec - tool execution facts.
 * @param query - lowercased filter text, or an empty string for all rows.
 * @returns rows ordered newest first.
 */
async function collectSessions(ctx: Context, exec: ExecLike, query: string): Promise<SessionRow[]> {
  const records = await ctx.sessionQuery.listSessions(exec.signal) as readonly SessionRecordLike[]
  const archived = archivedSessionIds(ctx)
  const labels = projectedTitles(ctx, records)
  const self = exec.agent?.session?.id
  const rows: SessionRow[] = []
  for (const record of records) {
    const { header } = record
    if (self !== undefined && header.id === self) continue
    const row: SessionRow = {
      sessionId: header.id,
      title: labels.get(header.id) ?? header.id,
      createdAt: header.createdAt,
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      ...(archived.has(header.id) ? { archived: true } : {}),
      ...(header.origin === 'subagent' ? { delegated: true } : {}),
    }
    if (query !== '' && !matchesQuery(row, query)) continue
    rows.push(row)
  }
  return rows
}

/**
 * Whether one row mentions the filter text in a place a user would name.
 * @param row - projected Session row.
 * @param query - lowercased filter text.
 * @returns whether the row matches.
 */
function matchesQuery(row: SessionRow, query: string): boolean {
  return row.title.toLowerCase().includes(query)
    || row.sessionId.toLowerCase().includes(query)
    || (row.cwd ?? '').toLowerCase().includes(query)
}

/**
 * Read display titles from Session projections without folding any log.
 * Attached Sessions answer from their live cut; cold Sessions use the
 * projection cache when it is composed, otherwise they stay titled by id.
 * @param ctx - Host context.
 * @param records - listed logical Sessions.
 * @returns display title per Session id.
 */
function projectedTitles(ctx: Context, records: readonly SessionRecordLike[]): Map<string, string> {
  const projections = ctx.get('sessionProjections') as ProjectionsLike | undefined
  const cache = ctx.get('sessionProjectionCache') as ProjectionCacheLike | undefined
  const attached = new Map(ctx.sessions.list().map(session => [session.id as string, session]))
  const keys = ['title', 'subagent']
  const labels = new Map<string, string>()
  for (const record of records) {
    const session = attached.get(record.header.id)
    let snapshot
    try {
      snapshot = session !== undefined && projections !== undefined
        ? projections.snapshot(session, keys)
        : cache?.cachedSnapshot(record.header, keys)
    } catch {
      // A projection that cannot answer for this Session keeps the id as its title.
      snapshot = undefined
    }
    const values = snapshot?.values
    const title = typeof values?.title === 'string' ? values.title : undefined
    const subagent = values?.subagent
    const label = subagent !== null && typeof subagent === 'object'
      && typeof (subagent as { label?: unknown }).label === 'string'
      ? (subagent as { label: string }).label
      : title
    if (label !== undefined) labels.set(record.header.id, label)
  }
  return labels
}

/**
 * Read the archived Session ids the Workspace registry currently reports.
 * @param ctx - Host context.
 * @returns archived ids; empty without a registry.
 */
function archivedSessionIds(ctx: Context): Set<string> {
  const registry = ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
  return new Set(registry?.archivedSessionIds ?? [])
}

/**
 * Resolve a session id or exact title to one listed Session.
 * Ids win over titles, exact titles over substring titles, and every
 * ambiguous or unknown outcome returns the candidates the caller should show.
 * @param records - listed logical Sessions.
 * @param labels - display title per Session id.
 * @param target - id or title supplied by the model.
 * @param self - calling Session id.
 * @returns the resolution the caller reports from.
 */
function resolveTarget(
  records: readonly SessionRecordLike[],
  labels: Map<string, string>,
  target: string,
  self: string | undefined,
): Resolution {
  const byId = records.find(record => record.header.id === target)
  if (byId !== undefined) {
    return self !== undefined && byId.header.id === self ? { kind: 'self' } : { kind: 'found', record: byId }
  }

  const exact = records.filter(record => labels.get(record.header.id) === target)
  const exactFirst = exact[0]
  if (exact.length === 1 && exactFirst !== undefined) return resolveSelfCheck(exactFirst, self)
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact.slice(0, MAX_CANDIDATES) }

  const lower = target.toLowerCase()
  const partial = records.filter(record => (labels.get(record.header.id) ?? '').toLowerCase().includes(lower))
  const partialFirst = partial[0]
  if (partial.length === 1 && partialFirst !== undefined) return resolveSelfCheck(partialFirst, self)
  if (partial.length > 1) return { kind: 'ambiguous', candidates: partial.slice(0, MAX_CANDIDATES) }
  return { kind: 'missing', candidates: [] }
}

/**
 * Reject a resolved Session that is the caller itself.
 * @param record - resolved listed Session.
 * @param self - calling Session id.
 * @returns the resolution for a resolved record.
 */
function resolveSelfCheck(record: SessionRecordLike, self: string | undefined): Resolution {
  return self !== undefined && record.header.id === self ? { kind: 'self' } : { kind: 'found', record }
}

/**
 * Render candidate rows for an error that asks the model to disambiguate.
 * @param candidates - listed Sessions.
 * @param labels - display title per Session id.
 * @returns comma-separated `title (id)` entries.
 */
function renderCandidates(candidates: readonly SessionRecordLike[], labels: Map<string, string>): string {
  return candidates
    .map(record => `${labels.get(record.header.id) ?? record.header.id} (${record.header.id})`)
    .join(', ')
}

/**
 * Normalize the roles a `session_read` call asked for.
 * @param value - raw `roles` argument.
 * @returns roles to project; defaults to every readable role.
 */
function requestedRoles(value: unknown): readonly ReadRole[] {
  if (!Array.isArray(value)) return READ_ROLES
  const roles: ReadRole[] = []
  for (const role of value) {
    if ((role === 'user' || role === 'assistant') && !roles.includes(role)) roles.push(role)
  }
  return roles.length === 0 ? READ_ROLES : roles
}

/**
 * Role of one surface event, or undefined for rows a read does not project.
 * @param event - surface event from `sessionQuery.readSurface`.
 * @returns the readable role.
 */
function messageRole(event: { readonly type?: unknown }): ReadRole | undefined {
  if (event?.type === 'user/message') return 'user'
  if (event?.type === 'assistant/message') return 'assistant'
  return undefined
}

/**
 * Concatenate the visible text blocks of one surface event.
 * Reasoning, images, files, and tool calls are deliberately left out.
 * @param event - surface event from `sessionQuery.readSurface`.
 * @returns trimmed text, or an empty string when the row carries none.
 */
function eventText(event: { readonly data?: unknown }): string {
  const data = event?.data as { message?: { content?: unknown } } | undefined
  const content = data?.message?.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const candidate = block as { type?: unknown, text?: unknown }
    if (candidate?.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text)
  }
  return parts.join('\n').trim()
}

/**
 * Bound one message text to the size a reading model should receive.
 * @param text - non-empty message text.
 * @returns the text, with an ellipsis when it was cut.
 */
function clipText(text: string): string {
  return text.length <= MAX_MESSAGE_CHARS ? text : `${text.slice(0, MAX_MESSAGE_CHARS)}…`
}