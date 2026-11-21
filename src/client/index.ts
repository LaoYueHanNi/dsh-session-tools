/**
 * Browser half of the session-tools plugin.
 *
 * Browser contributions:
 *
 * A `/` command row (Session message / 会话消息): opening it lists Sessions, and picking one
 * fills a target MARKER into the composer. Whatever the user types after the
 * marker is an instruction for the model, which then composes the message and
 * calls `session_send` — there is no direct-delivery command path on purpose.
 *
 * The picker uses the shared `popupSelect` shell instead of a self-rendered
 * overlay: the shell owns its anchoring, surface material, search field, and
 * keyboard handling. Its detail slot is left-aligned, so the directory and the
 * activity time share one right-hand string rather than two aligned columns.
 *
 * This module is the bundle's entry: tsdown wraps it in the
 * `window.__ModuleLoader__.load` factory the web shell consumes, so the source
 * keeps plain ES-module imports. React and Cordis resolve through the shell's
 * frozen module table (declared external in tsdown.config.ts).
 *
 * @module dsh-session-tools/client
 */

import React from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/**
 * The narrow service surface this bundle touches, declared structurally so the
 * bundle compiles against its own contract instead of every published Client
 * typings revision. Each member mirrors the service it names.
 */
interface SlotsService {
  inject(slot: string, contribute: () => unknown): unknown
  register(spec: Record<string, unknown>, component: unknown): unknown
}

interface CommandsService {
  register(command: Record<string, unknown>): unknown
}

interface InputTriggersService {
  registerSource(source: Record<string, unknown>): unknown
}

interface LocaleService {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): unknown
  bind(namespace: string): (key: string) => string
}

interface SessionSummaryLike {
  readonly cwd?: unknown
  readonly title?: unknown
  readonly displayTitle?: unknown
  readonly blank?: unknown
  readonly origin?: unknown
  readonly updatedAt?: unknown
  readonly createdAt?: unknown
}

interface SessionIndex {
  getSnapshot(): { readonly ids?: readonly string[], readonly byId?: Record<string, SessionSummaryLike>, readonly phase?: string } | null | undefined
}

interface SessionScope {
  readonly sessionId: string
}

interface ComposerInput {
  setDraft(text: string): unknown
  focus?(): unknown
  notify?(kind: string, text: string): unknown
  insertReference?(chip: Record<string, unknown>, span: Record<string, unknown>): boolean
  addReferences?(chips: readonly Record<string, unknown>[]): boolean
  state?: { getSnapshot?(): { draft?: unknown, draftRev?: unknown, phase?: unknown } | null | undefined }
}

interface ConversationService {
  input: { for(scope: SessionScope): ComposerInput }
}

interface SessionsService {
  list: SessionIndex
  scope(sessionId: string): SessionScope | undefined
}

/** A context that may carry the optional services this bundle injects. */
type Scope = ClientContext & {
  effect?(execute: () => unknown, label?: string): unknown
  slots: SlotsService
  sessions: SessionsService
  conversation: ConversationService
  workspaces: { readonly list: { getSnapshot(): { readonly archivedSessionIds?: readonly string[], readonly phase?: string } } }
  inputTriggers?: InputTriggersService
  commandUi?: CommandsService
  locale?: LocaleService
}

/** Element factory with lax props typing: these trees carry CSS custom properties. */
const h = React.createElement as (
  type: string,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
) => unknown

/** Longest title a picker row carries before it is cut for display. */
const MAX_ROW_TITLE = 80

/** Source name owning the target chip, so its serialization never becomes a session reference URI. */
const CHIP_SOURCE = 'session-tool-target'

/** Locale namespace this bundle registers its copy under. */
const NS = 'session-tools-client'

/** Every visible string this bundle renders, per locale. English is the fallback. */
const STRINGS = {
  en: {
    'command.label': 'Session message',
    'command.description': 'Pick a Session, then say what to send',
    'search.placeholder': 'Search sessions…',
    'search.empty': 'No Sessions to pick',
    'search.noResults': 'No matching Sessions',
    'untitled': 'Untitled Session',
    'marker.wrap': 'Target session: {}',
    'notice.prefix': 'Session message: {}',
    'time.now': 'now',
  },
  zh: {
    'command.label': '会话消息',
    'command.description': '选一个会话，然后告诉我要发什么',
    'search.placeholder': '搜索会话…',
    'search.empty': '没有可选择的会话',
    'search.noResults': '没有匹配的会话',
    'untitled': '未命名会话',
    'marker.wrap': '目标会话：{}',
    'notice.prefix': '会话消息：{}',
    'time.now': '刚刚',
  },
} as const

/** Placeholder every template string carries; replaced with its one argument. */
const SLOT = '{}'

/**
 * Resolve one copy key in the active locale, falling back to English, then the key.
 * Replaced by the locale service's bound translator once it registers, so a
 * language switch is picked up by the next render or call without re-mounting.
 * @param key - dot path into {@link STRINGS}.
 * @param arg - optional value for the `{}` slot.
 * @returns the localized string.
 */
let t = (key: string, arg?: string): string => {
  const en = (STRINGS.en as Record<string, string>)[key]
  if (en === undefined) return key
  return arg === undefined ? en : en.split(SLOT).join(arg)
}

/** Replace `{}` with the argument in a translated template. */
function fill(template: string, arg: string): string {
  return template.split(SLOT).join(arg)
}

/** Titles captured when a chip is inserted, read back by the chip serializer. */
const chipTitles = new Map<string, string>()

/** One picker row. */
interface PickerOption {
  readonly id: string
  readonly label: string
  readonly detail?: string
}

/**
 * Model-facing form of one target chip.
 *
 * Deliberately NOT `@[label](dsh-session:…)`: that URI is what makes the
 * session-reference plugin inject a read-only snapshot of the target. The
 * bracket marker below is only context for the model, so no session content
 * is ever read.
 * @param ref - target Session id.
 * @returns the marker text placed in the submitted prompt.
 */
function renderTargetMarker(ref: string): string {
  return `[${t('marker.wrap', ref)}]`
}

/**
 * Trigger source that exists only to own the chip's serializer. It returns no
 * candidates and never picks: the picker itself is the `/` command row.
 */
const chipSource = {
  trigger: '/',
  name: CHIP_SOURCE,
  showGroupTitle: false,
  async candidates(): Promise<never[]> {
    return []
  },
  onPick(): undefined {
    return undefined
  },
  codec: {
    clipboardText: (ref: string): string => `@${chipTitles.get(ref) ?? ref}`,
    async serialize(ref: string): Promise<string> {
      return renderTargetMarker(ref)
    },
  },
}

/**
 * Menu glyph: a speech bubble with an outbound arrow.
 * @param props - element props supplied by the command row.
 * @returns the icon element.
 */
function SessionToolIcon(props: Record<string, unknown>): unknown {
  return h(
    'svg',
    {
      width: 16,
      height: 16,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      ...props,
    },
    h('path', { d: 'M2.5 3h7.5a1 1 0 0 1 1 1v4.2a1 1 0 0 1-1 1H6.2L3.5 11.6V9.2h-1a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z' }),
    h('path', { d: 'M12.9 7.4h.6a1 1 0 0 1 1 1v3.1a1 1 0 0 1-1 1h-.6v1.7l-2-1.7' }),
  )
}

/**
 * Last path segment, so a row can name its workspace without the whole path.
 * @param path - absolute or Windows-style directory.
 * @returns the trailing segment, or an empty string.
 */
function lastSegment(path: unknown): string {
  if (typeof path !== 'string' || path === '') return ''
  const parts = path.replace(/[\\/]+$/u, '').split(/[\\/]/u)
  const tail = parts.length === 0 ? '' : parts[parts.length - 1]
  return typeof tail === 'string' ? tail : ''
}

/**
 * Compact relative age in the sidebar's own vocabulary.
 * @param timestamp - Unix epoch milliseconds.
 * @returns `刚刚`, `3m`, `2h`, `5d`, or a yyyy-mm-dd date; empty when unknown.
 */
function relativeTime(timestamp: unknown): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return ''
  const elapsed = Date.now() - timestamp
  if (elapsed < 60_000) return t('time.now')
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  return new Date(timestamp).toISOString().slice(0, 10)
}

/**
 * Build picker rows from the rc.5 catalog and archive metadata. The popup
 * filters these rows locally, so include the complete Host catalog and put
 * the unabridged title and ID in the searchable detail field.
 * Blank Sessions are intentionally omitted: they are reusable sidebar drafts.
 * @param ctx - client root context.
 * @param sessionId - asking Session.
 * @param signal - popup cancellation.
 * @returns sendable picker options in Host catalog order.
 */
async function sessionOptions(ctx: Scope, sessionId: string, signal: AbortSignal): Promise<PickerOption[]> {
  signal.throwIfAborted()
  const snapshot = ctx.sessions.list.getSnapshot()
  const workspace = ctx.workspaces.list.getSnapshot()
  // Archive membership is authoritative only after its baseline is ready.
  if (snapshot?.phase !== 'ready' || workspace.phase !== 'ready'
    || !Array.isArray(snapshot.ids) || !Array.isArray(workspace.archivedSessionIds)) return []
  const archived = new Set(workspace.archivedSessionIds)
  const rows: PickerOption[] = []
  for (const id of snapshot.ids) {
    const row = snapshot.byId?.[id]
    if (row === undefined || id === sessionId || row.origin === 'subagent' || row.blank !== false || archived.has(id)) continue
    const title = typeof row.title === 'string' && row.title.trim() !== ''
      ? row.title : typeof row.displayTitle === 'string' && row.displayTitle !== '' ? row.displayTitle : t('untitled')
    const label = title.length <= MAX_ROW_TITLE ? title : `${title.slice(0, MAX_ROW_TITLE)}…`
    const detail = [title, id, lastSegment(row.cwd), relativeTime(row.updatedAt)]
      .filter(part => part !== '').join(' · ')
    rows.push({ id, label, detail })
  }
  return rows
}

/**
 * Surface one composer failure both in the console and as a composer notice,
 * so a refused chip is diagnosable without opening devtools.
 * @param input - resolved input facade, when one was reached.
 * @param reason - short machine-readable reason.
 * @param detail - optional error or value behind the reason.
 */
function reportFillFailure(input: ComposerInput | undefined, reason: string, detail?: unknown): void {
  console.warn('[session-tools]', reason, detail)
  try {
    input?.notify?.('error', fill(t('notice.prefix'), reason))
  } catch {
    // A missing notice channel must not mask the failure itself.
  }
}

/**
 * Insert the chosen target as an `@`-style chip after the caret in the asking
 * Session's composer, leaving any text the user already typed untouched.
 *
 * The chip is what makes the selection visible as a token instead of plain
 * text; its serializer emits a localized target marker (`[目标会话：<sessionId>]` / `[Target session: <sessionId>]`), so the submitted prompt is
 * that marker followed by whatever the user typed. When the editor refuses
 * chips, the same marker is appended as plain text after the existing draft.
 * @param ctx - client root context.
 * @param sessionId - asking Session.
 * @param option - chosen target: id plus display label.
 * @returns whether the composer accepted the marker.
 */
function fillComposer(ctx: Scope, sessionId: string, option: PickerOption): boolean {
  let input: ComposerInput
  try {
    const scope = ctx.sessions.scope(sessionId)
    if (scope === undefined) {
      reportFillFailure(undefined, 'no session scope')
      return false
    }
    input = ctx.conversation.input.for(scope)
  } catch (error) {
    reportFillFailure(undefined, 'no input facade', error)
    return false
  }

  chipTitles.set(option.id, option.label)
  const chip = {
    source: CHIP_SOURCE,
    ref: option.id,
    label: option.label,
    appearance: 'session',
    clipboardText: `@${option.label}`,
  }

  // The picker closes after onSelect, and the composer leaves its read-only
  // phase one tick later, so insert on the next task rather than inline.
  setTimeout(() => {
    let inserted = false
    let state: { draft?: unknown, draftRev?: unknown, phase?: unknown } = {}
    try {
      state = input.state?.getSnapshot?.() ?? {}
    } catch {
      state = {}
    }

    // insertReference only guards phase and revision, while addReferences
    // also requires canInsertReferences, which stays false under a claimed
    // command. An empty span at the draft end inserts without deleting text.
    try {
      const end = typeof state.draft === 'string' ? state.draft.length : 0
      const span = {
        start: end,
        end,
        draftRev: typeof state.draftRev === 'number' ? state.draftRev : 0,
      }
      inserted = input.insertReference?.(chip, span) === true
    } catch (error) {
      reportFillFailure(input, 'insertReference threw', error)
    }
    if (!inserted) {
      try {
        inserted = input.addReferences?.([chip]) === true
      } catch (error) {
        reportFillFailure(input, 'addReferences threw', error)
      }
    }

    if (!inserted) {
      try {
        const existing = typeof state.draft === 'string' ? state.draft : ''
        // Drop the bare trigger character the picker was opened from.
        const kept = existing.replace(/^\/\s*/u, '')
        const marker = renderTargetMarker(option.id)
        input.setDraft(kept.trim() === '' ? `${marker} ` : `${kept.trimEnd()} ${marker} `)
        reportFillFailure(
          input,
          `chip refused (insertRef=${typeof input.insertReference}, addRefs=${typeof input.addReferences}, phase=${String(state.phase)}, used text marker)`,
        )
      } catch (error) {
        reportFillFailure(input, 'marker fallback threw', error)
      }
    }
    input.focus?.()
  }, 0)
  return true
}

export const name = 'session-tools-client'

export const inject = ['slots', 'commandUi', 'sessions', 'conversation', 'remote', 'inputTriggers']

/**
 * Register the browser contributions.
 * @param ctx - client root context.
 */
export function apply(ctx: Scope): void {
  // Register this bundle's copy under its own namespace and rebind the module
  // translator, so every visible string follows the interface language. The
  // bound function resolves on each call, so a language switch is picked up
  // without re-mounting anything; hosts without the service keep English.
  ctx.inject(['locale'], (scope) => {
    const typed = scope as Scope
    typed.effect?.(() => {
      const unregister = typed.locale?.register(
        NS,
        STRINGS as unknown as Record<string, Record<string, string>>,
      )
      const bound = typed.locale?.bind(NS)
      if (typeof bound === 'function') {
        const fallback = t
        t = (key, arg) => {
          const template = bound(key)
          return arg === undefined ? template : fill(template, arg)
        }
        return () => {
          t = fallback
          return unregister
        }
      }
      return unregister
    }, 'session-tools-client: locale dictionaries')
  })

  // The chip's serializer has to be routable by source name; registering a
  // candidate-less source is the supported way to own one.
  ctx.inject(['inputTriggers'], (scope) => {
    const typed = scope as Scope
    typed.effect?.(() => typed.inputTriggers?.registerSource(chipSource), 'session-tools-client: target chip source')
  })

  ctx.inject(['commandUi', 'workspaces'], (scope) => {
    const typed = scope as Scope
    // A client-owned command, so this row exists without a Host command
    // behind it and can carry the plugin's own icon and localized label.
    //
    // The pick fills a target MARKER, not a command line: the marker plus
    // whatever the user types next reaches the model as one ordinary
    // prompt, and the model then composes the message and calls
    // session_send.
    typed.effect?.(() => typed.commandUi?.register({
      name: 'session-msg',
      label: () => t('command.label'),
      description: () => t('command.description'),
      icon: SessionToolIcon,
      available: () => true,
      ui: {
        kind: 'popupSelect',
        searchLabels: () => ({
          placeholder: t('search.placeholder'),
          empty: t('search.empty'),
          noResults: t('search.noResults'),
        }),
        options: (session: { readonly sessionId: string }, signal: AbortSignal) =>
          sessionOptions(typed, session.sessionId, signal),
        onSelect: (option: PickerOption, session: { readonly sessionId: string }) => {
          fillComposer(typed, session.sessionId, option)
        },
      },
    }), 'session-tools-client: /session-msg picker')
  })
}
