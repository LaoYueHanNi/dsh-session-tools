import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { apply } from '../lib/index.js'

class LocalSessionQuery extends SessionQueryEngine {}

const ctx = new Context()
const store = await ctx.plugin(SessionStore)
const query = await ctx.plugin(LocalSessionQuery)
try {
  const target = ctx.sessions.create(undefined, { cwd: process.cwd() })
  const userSeq = target.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '真实宿主的用户提问' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' }).seq
  const assistantSeq = target.append('assistant/message', {
    turn: 0,
    step: 0,
    stream: [],
    message: createAssistantMessage({
      content: [
        { type: 'reasoning', text: '不应返回内部推理' },
        { type: 'text', text: '真实宿主的助手回答' },
      ],
      source: { provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' }).seq

  const tools = new Map()
  apply({
    tools: { register: tool => tools.set(tool.name, tool) },
    sessions: ctx.sessions,
    sessionQuery: ctx.sessionQuery,
    get: () => undefined,
  })
  const read = tools.get('session_read')
  const exec = { signal: new AbortController().signal }
  const both = await read.execute({ target: target.id }, exec)
  const userOnly = await read.execute({ target: target.id, roles: ['user'] }, exec)
  const tail = await read.execute({ target: target.id, limit: 1 }, exec)

  const user = { seq: userSeq, role: 'user', text: '真实宿主的用户提问' }
  const assistant = { seq: assistantSeq, role: 'assistant', text: '真实宿主的助手回答' }
  const messageFields = ({ seq, role, text }) => ({ seq, role, text })
  assert.deepEqual(both.messages.map(messageFields), [user, assistant])
  assert.deepEqual(userOnly.messages.map(messageFields), [user])
  assert.deepEqual(tail.messages.map(messageFields), [assistant])
  assert.equal(tail.truncated, true)

  let promptCalls = 0
  apply({
    tools: { register: tool => tools.set(tool.name, tool) },
    sessions: ctx.sessions,
    sessionQuery: ctx.sessionQuery,
    get: () => undefined,
    agents: { get: () => undefined },
    sessionController: {
      modelCatalog: async () => ({
        default: { provider: 'fixture', model: 'fixture' },
        groups: [{ id: 'fixture', models: [{ id: 'fixture' }] }],
      }),
      create: async () => ({ sessionId: 'already-created' }),
      prompt: async () => { promptCalls++ },
    },
  })
  const failure = await tools.get('session_create').execute({
    provider: 'fixture', model: 'fixture', message: '首条任务',
  }, { ...exec, callId: 'setup-regression' })
  assert.equal(failure.status, 'setup_failed')
  assert.equal(failure.sessionId, 'already-created')
  assert.equal(failure.delivered, false)
  assert.match(failure.failure, /No live Agent/)
  assert.equal(promptCalls, 0)

  const requests = []
  const agent = { session: target }
  apply({
    tools: { register: tool => tools.set(tool.name, tool) },
    sessions: ctx.sessions,
    sessionQuery: ctx.sessionQuery,
    get: () => undefined,
    agents: { get: id => id === target.id ? agent : undefined },
    sessionController: { prompt: async request => { requests.push(request) } },
  })
  const send = tools.get('session_send')
  const sendArgs = { target: target.id, message: '宿主回执检查' }
  const unchecked = await send.execute(sendArgs, { ...exec, callId: 'checkpoint-fixture' })
  assert.equal(unchecked.accepted, true)
  assert.equal(unchecked.persisted, false)

  let checkpointSessionId
  const unsubscribe = ctx.on('session/flush', (session) => { checkpointSessionId = session.id })
  try {
    const checked = await send.execute({ ...sendArgs, requestId: unchecked.requestId }, { ...exec, callId: 'checkpoint-retry' })
    assert.equal(checked.status, 'accepted')
    assert.equal(checked.persisted, true)
    assert.equal(checkpointSessionId, target.id)
    assert.deepEqual(requests.map(request => request.requestId), [unchecked.requestId, unchecked.requestId])
  } finally {
    unsubscribe()
  }
} finally {
  await query.dispose()
  await store.dispose()
}

console.log('host contracts: all assertions passed')
