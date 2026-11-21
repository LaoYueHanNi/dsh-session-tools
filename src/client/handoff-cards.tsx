import React, { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ChatNode, ChatSnapshot, ToolCallBlock, TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session'

interface Receipt {
  readonly callId: string
  readonly seq: number
  readonly sessionId: SessionId
  readonly title?: string
  readonly created: boolean
}

type OpenSession = (id: SessionId) => void
type CardLocale = PropsLocale<'session-tools-client'>
type LocalChat = {
  getSnapshot(): ChatSnapshot | undefined
  subscribe(listener: () => void): () => void
}

const previewsByNodes = new WeakMap<ReturnType<ChatSnapshot['nodes']['values']>, ReadonlyMap<string, string>>()
const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' })

export function isHandoffRequest(rpcId: unknown): rpcId is string {
  return typeof rpcId === 'string' && /^session-(?:send|create):.+:[^:]+$/u.test(rpcId)
}

function messageFor(chat: LocalChat, rpcId: string): string {
  const nodes = chat.getSnapshot()?.nodes.values()
  if (nodes === undefined) return ''
  let messages = previewsByNodes.get(nodes)
  if (messages === undefined) {
    const collected = new Map<string, string>()
    for (const node of nodes as readonly ChatNode[]) {
      if (node.kind !== 'user') continue
      const source = node.data.source
      if (typeof source !== 'object' || source === null || !('rpcId' in source) || !isHandoffRequest(source.rpcId)) continue
      collected.set(source.rpcId, node.data.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n'))
    }
    messages = collected
    previewsByNodes.set(nodes, messages)
  }
  return messages.get(rpcId) ?? ''
}

function incomingSummary(text: string): { sender: string; preview: string } {
  const envelope = /^\[来自会话「([^\r\n]+)」\([^\r\n()]+\)\]\r?\n\r?\n/u.exec(text)
  const body = (envelope === null ? text : text.slice(envelope[0].length)).trimStart()
  const firstLine = body.split(/\r?\n/u, 1)[0]?.trim() ?? ''
  const preview = sentences.segment(firstLine)[Symbol.iterator]().next().value?.segment.trim() ?? ''
  const characters = Array.from(preview)
  return {
    sender: envelope?.[1]?.trim() ?? '',
    preview: characters.length > 120 ? `${characters.slice(0, 119).join('')}…` : preview,
  }
}

const incomingStyle = `
  [data-session-incoming] { width: 100%; min-width: 0; }
  [data-session-incoming] > summary::-webkit-details-marker { display: none; }
  [data-session-incoming][open] [data-session-chevron] { transform: rotate(180deg); }
  [data-slot]:has(> [data-session-incoming]:not([open])) ~ :has(> [data-message-bubble]),
  [data-slot]:has(> [data-session-incoming]) ~ [data-clock] { display: none; }
  [data-slot]:has(> [data-session-incoming][open]) ~ :has(> [data-message-bubble]) {
    width: 100%; max-width: none; align-items: stretch;
  }
  [data-slot]:has(> [data-session-incoming]) ~ * > [data-message-bubble] {
    background: transparent; border: 0; padding: 8px 16px;
  }
`

export function IncomingHandoff({ rpcId, chat, t }: CardLocale & {
  readonly rpcId: string
  readonly chat: LocalChat
}) {
  const text = useSyncExternalStore(chat.subscribe, () => messageFor(chat, rpcId))
  const { sender, preview } = incomingSummary(text)
  const created = rpcId.startsWith('session-create:')
  const title = sender === ''
    ? { lead: t(created ? 'handoff.created' : 'handoff.incoming') }
    : created
      ? { lead: t('handoff.createdBy.lead'), name: sender, trail: t('handoff.createdBy.trail') }
      : { lead: t('handoff.from.lead'), name: sender }
  return (
    <details data-session-incoming="">
      <summary style={cardStyle}>
        <CardContent {...title} detail={preview} />
        <span aria-hidden="true" style={cardActionStyle}>
          <svg data-session-chevron="" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
            <path d="m4 6 4 4 4-4" />
          </svg>
        </span>
      </summary>
    </details>
  )
}

export function mountIncomingHandoffStyle(): () => void {
  const stylesheet = document.createElement('style')
  stylesheet.textContent = incomingStyle
  document.head.append(stylesheet)
  return () => stylesheet.remove()
}

function collectReceipts(block: ToolCallBlock, receipts: Receipt[]): void {
  if ('kind' in block && block.kind === 'tool-result' && !block.isError
    && (block.name === 'session_send' || block.name === 'session_create')) {
    const created = block.name === 'session_create'
    for (const part of block.content) {
      if (part.type !== 'text') continue
      let value: unknown
      try {
        value = JSON.parse(part.text)
      } catch {
        continue
      }
      if (value === null || typeof value !== 'object' || !('sessionId' in value)
        || typeof value.sessionId !== 'string' || value.sessionId.trim() === '') continue
      if ('status' in value && value.status !== 'accepted') continue
      if (created ? !('delivered' in value && value.delivered === true) : !('accepted' in value && value.accepted === true)) continue
      receipts.push({
        callId: block.callId,
        seq: block.seq,
        sessionId: value.sessionId as SessionId,
        ...('title' in value && typeof value.title === 'string' && value.title.trim() !== '' ? { title: value.title } : {}),
        created,
      })
      break
    }
  }
  for (const child of block.subCalls) collectReceipts(child, receipts)
}

function receiptsForTurn(snapshot: ChatSnapshot | undefined, turn: number): Receipt[] {
  const receipts: Receipt[] = []
  if (snapshot === undefined) return receipts
  for (const key of snapshot.locations.getTurn(turn)) {
    const node = snapshot.nodes.get(key) as ChatNode | undefined
    if (node?.kind === 'tool-call') collectReceipts(node.data.root, receipts)
  }
  return receipts.sort((left, right) => left.seq - right.seq)
}

const cardStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 60,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '9px 12px',
  textAlign: 'start',
  font: 'inherit',
  color: 'var(--dsw-alias-label-primary, inherit)',
  background: 'var(--dsw-alias-card-fill, transparent)',
  border: '1px solid var(--dsw-alias-border-l1, currentColor)',
  borderRadius: 'var(--dsw-radius-lg, 12px)',
  cursor: 'pointer',
}

const cardActionStyle: React.CSSProperties = { flex: 'none', marginInlineStart: 'auto', paddingInline: 4 }
const singleLine: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const titleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  minWidth: 0,
  fontSize: 14,
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const nameStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  maxWidth: '100%',
  flex: '0 1 auto',
  padding: '1px 6px',
  border: '1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l1, currentColor))',
  borderRadius: 6,
  color: 'var(--dsw-alias-label-primary, inherit)',
  background: 'var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-card-tile-fill, transparent))',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '17px',
}

export function SessionName({ name }: { readonly name: string }) {
  return (
    <span
      data-session-name=""
      title={name}
      style={nameStyle}
    >{name}</span>
  )
}

function CardContent({ lead, name, trail, detail }: {
  readonly lead: string
  readonly name?: string
  readonly trail?: string
  readonly detail: string
}) {
  return (
    <>
      <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', flex: '0 0 34px', height: 34, borderRadius: 8, background: 'var(--dsw-alias-card-tile-fill, transparent)' }}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8l-4 3v-3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
          <path d="M7 8.5h6m-2-2 2 2-2 2" />
        </svg>
      </span>
      <span style={{ display: 'grid', flex: 1, minWidth: 0, gap: 2 }}>
        <span style={titleStyle}>
          <span style={{ flex: 'none' }}>{lead}</span>
          {name !== undefined && <SessionName name={name} />}
          {trail !== undefined && trail !== '' && <span style={{ flex: 'none' }}>{trail}</span>}
        </span>
        {detail !== '' && <span style={{ ...singleLine, fontSize: 12, color: 'var(--dsw-alias-label-secondary, inherit)' }}>{detail}</span>}
      </span>
    </>
  )
}

interface CardProps extends TurnTailOwnerProps, CardLocale {
  readonly chat: LocalChat
  readonly openSession: OpenSession
}

function HandoffCards({ turn, chat, openSession, t }: CardProps) {
  const snapshot = useSyncExternalStore(chat.subscribe, chat.getSnapshot)
  const receipts = receiptsForTurn(snapshot, turn.turn)
  if (receipts.length === 0) return null
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {receipts.map(receipt => {
        const name = receipt.title ?? t(receipt.created ? 'card.newSession' : 'card.session')
        const openLabel = t('card.open', { name })
        const status = t(receipt.created ? 'card.created' : 'card.accepted')
        return (
          <button key={receipt.callId} type="button" style={cardStyle}
            aria-label={`${openLabel} · ${status}`}
            title={openLabel}
            onClick={() => openSession(receipt.sessionId)}>
            <CardContent lead={t('handoff.to.lead')} name={name} detail={status} />
            <span aria-hidden="true" style={cardActionStyle}>↗</span>
          </button>
        )
      })}
    </div>
  )
}

export function registerHandoffCards(ctx: Context, locale: 'session-tools-client'): void {
  ctx.inject(['slots', 'uiConversation', 'uiWorkspace'], scope => {
    const navigation = scope.get('uiWorkspace') as { openSession: OpenSession }
    return scope.slots.inject('conversation.chat.turnTail', () => scope.slots.register({
      name: 'conversation.chat.turnTail',
      id: 'session-tools-handoff-receipts',
      locale,
      inject: sessionId => ({
        chat: scope.uiConversation.binding(sessionId as SessionId).target('chat'),
        openSession: (id: SessionId) => navigation.openSession(id),
      }),
    }, HandoffCards))
  })
}
