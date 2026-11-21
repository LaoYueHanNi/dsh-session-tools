import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'

const entry = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const react = { ...React, useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() }
const modules = { react, 'react/jsx-runtime': jsxRuntime }
let client
runInNewContext(entry, {
  window: { __ModuleLoader__: { load: ({ factory }) => {
    client = factory(id => {
      assert.ok(Object.hasOwn(modules, id), `unexpected client import ${id}`)
      return modules[id]
    })
  } } },
})

let cardSlot
let incomingSlot
let dictionaries
const opened = []
const bindings = []
const source = { subscribe: () => () => {}, getSnapshot: () => currentSnapshot }
const navigation = { openSession: id => opened.push(id) }
const translate = locale => (key, params = {}) => dictionaries[locale][key].replace(/\{(\w+)\}/g, (token, name) => params[name] ?? token)
const ctx = {
  inject: (_services, activate) => activate(ctx),
  effect: activate => activate(),
  locale: {
    register: (_namespace, messages) => { dictionaries = messages },
    bind: () => translate('en'),
  },
  slots: {
    inject: (_slot, activate) => activate(),
    register(spec, render) {
      if (spec.name === 'conversation.chat.turnTail') cardSlot = { spec, render }
      if (spec.name === 'conversation.chat.user.before') incomingSlot = { spec, render }
    },
  },
  uiConversation: { binding: id => ({ target: target => {
    bindings.push({ id, target })
    return source
  } }) },
  get: key => key === 'uiWorkspace' ? navigation : undefined,
}
client.apply(ctx)
assert.ok(cardSlot, 'the client factory registers a turn-tail renderer')
assert.ok(incomingSlot, 'the client factory registers a user-row decoration')
assert.equal(cardSlot.spec.locale, 'session-tools-client')
assert.equal(incomingSlot.spec.locale, cardSlot.spec.locale)

const incomingMessages = [
  ['session-send:call-1:session-target', '[来自会话「原始会话」(session-origin)]\n\n第一句话。第二句话。\n\n[回报方式：请回信。]', ['Received from', '原始会话'], ['接收自', '原始会话'], '第一句话。'],
  ['session-create:call-2:session-target', '[来自会话「创建方」(session-origin)]\n\nFirst task. Second sentence.', ['Created by', '创建方', ''], ['由', '创建方', '创建'], 'First task.'],
  ['session-create:anonymous:session-target', '\n\nFirst sentence. Second sentence.', ['Session created'], ['会话已创建'], 'First sentence.'],
  ['session-send:long:session-target', '长'.repeat(150), ['Received a session message'], ['收到会话消息'], `${'长'.repeat(119)}…`],
  ['session-send:missing:session-target', undefined, ['Received a session message'], ['收到会话消息'], ''],
]
const incomingNodes = incomingMessages.flatMap(([rpcId, text]) => text === undefined ? [] : [{
  kind: 'user', data: { source: { kind: 'user', rpcId }, content: [{ type: 'text', text }] },
}])
let currentSnapshot = { nodes: { values: () => incomingNodes } }
const incomingInjected = incomingSlot.spec.inject('recipient')

for (const [rpcId, , englishTitle, chineseTitle, detail] of incomingMessages) {
  const matched = incomingSlot.spec.select({ kind: 'user', source: { kind: 'user', rpcId } })
  const component = incomingSlot.render({ matched, ...incomingInjected, t: translate('en') })
  const disclosure = component.type(component.props)
  assert.equal(disclosure.type, 'details')
  assert.equal(disclosure.props.open, undefined)
  const card = disclosure.props.children.props.children[0]
  assert.deepEqual([card.props.lead, card.props.name, card.props.trail], [
    englishTitle[0], englishTitle[1], englishTitle[2],
  ])
  assert.equal(card.props.detail, detail)
  assert.equal(disclosure.props.children.props.children[1].props.children.type, 'svg')
  const chineseIncoming = incomingSlot.render({ matched, ...incomingInjected, t: translate('zh') })
  const chineseCard = chineseIncoming.type(chineseIncoming.props).props.children.props.children[0]
  assert.deepEqual([chineseCard.props.lead, chineseCard.props.name, chineseCard.props.trail], [
    chineseTitle[0], chineseTitle[1], chineseTitle[2],
  ])
}
assert.equal(incomingSlot.spec.select({ kind: 'user', source: { kind: 'user', rpcId: 'ordinary-request' } }), null)
assert.equal(incomingSlot.spec.select({ kind: 'steering', source: { kind: 'user', rpcId: 'session-send:call-1:session-target' } }), null)
const historical = { kind: 'session-handoff', senderTitle: 'Original sender' }
assert.equal(incomingSlot.spec.select({ kind: 'user', source: historical }), historical)

function result(name, seq, payload, options = {}) {
  return {
    kind: 'tool-result', name, seq, callId: `${name}-${seq}`,
    isError: false, subCalls: [], content: [{ type: 'text', text: JSON.stringify(payload) }], ...options,
  }
}

const nodes = new Map([
  ['send', { kind: 'tool-call', data: { root: result('session_send', 9, { sessionId: 'target-2', title: 'Same title', accepted: true }) } }],
  ['nested', { kind: 'tool-call', data: { root: result('run_code', 6, {}, { subCalls: [
    result('session_create', 5, { sessionId: 'target-1', title: 'Same title', delivered: true }),
  ] }) } }],
  ['failed', { kind: 'tool-call', data: { root: result('session_send', 10, { sessionId: 'failed', accepted: true }, { isError: true }) } }],
  ['unknown', { kind: 'tool-call', data: { root: result('session_create', 11, { sessionId: 'unknown', delivered: false }) } }],
  ['contradictory', { kind: 'tool-call', data: { root: result('session_send', 12, { sessionId: 'uncertain', accepted: true, status: 'unknown' }) } }],
  ['other-turn', { kind: 'tool-call', data: { root: result('session_send', 18, { sessionId: 'target-3', accepted: true }) } }],
])
currentSnapshot = { nodes, locations: { getTurn: turn => turn === 1 ? ['send', 'nested', 'failed', 'unknown', 'contradictory'] : ['other-turn'] } }
const injected = cardSlot.spec.inject('origin')
const firstTurn = cardSlot.render({ ...injected, turn: { turn: 1 }, t: translate('en') })
const buttons = firstTurn.props.children
assert.equal(buttons.length, 2)
assert.match(buttons[0].props['aria-label'], /First message accepted/)
assert.match(buttons[1].props['aria-label'], /Message accepted/)
assert.equal(buttons[1].props.children[0].props.lead, 'Sent to')
assert.equal(buttons[1].props.children[0].props.name, 'Same title')
const chineseButton = cardSlot.render({ ...injected, turn: { turn: 1 }, t: translate('zh') }).props.children[1]
assert.equal(chineseButton.props.children[0].props.lead, '发送到')
assert.equal(chineseButton.props.children[0].props.name, 'Same title')
assert.equal(chineseButton.props.children[0].props.detail, '投递已受理')
assert.deepEqual(opened, [])
buttons[0].props.onClick()
buttons[1].props.onClick()
assert.deepEqual(opened, ['target-1', 'target-2'])
assert.deepEqual(bindings, [{ id: 'recipient', target: 'chat' }, { id: 'origin', target: 'chat' }])

const secondTurn = cardSlot.render({ ...injected, turn: { turn: 2 }, t: translate('en') })
assert.equal(secondTurn.props.children.length, 1)
assert.match(secondTurn.props.children[0].props['aria-label'], /Open Session/)
currentSnapshot = undefined
assert.equal(cardSlot.render({ ...injected, turn: { turn: 1 }, t: translate('en') }), null)
console.log('handoff cards: all assertions passed')

// The same built client bundle also exposes the candidate picker.
await import('./candidate-picker.mjs')
