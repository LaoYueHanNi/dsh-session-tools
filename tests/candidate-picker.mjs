import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { apply as applyHost } from '../lib/index.js'

const modules = { react: React, 'react/jsx-runtime': jsxRuntime }
let client
runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: ({ id, factory }) => {
    assert.equal(id, '@laoyuehanni/dsh-session-tools')
    client = factory(name => { assert.ok(Object.hasOwn(modules, name)); return modules[name] })
  } } },
  setTimeout, console,
})
let command
let readCount = 0
const ids = Array.from({ length: 70 }, (_, i) => `session-${String(i).padStart(3, '0')}`)
const longTitle = `${'x'.repeat(90)} unique-ending`
const byId = Object.fromEntries(ids.map((id, i) => [id, {
  id, title: i === 69 ? longTitle : `Title ${i}`, displayTitle: `Title ${i}`,
  blank: false, running: false, retainedBy: {}, updatedAt: i,
}]))
Object.assign(byId, {
  self: { id: 'self', title: 'Self', blank: false },
  archived: { id: 'archived', title: 'Archived', blank: false },
  child: { id: 'child', title: 'Child', blank: false, origin: 'subagent' },
  blank: { id: 'blank', displayTitle: 'Blank', blank: true },
  retained: { id: 'retained', title: 'Not in catalog', blank: false },
})
ids.push('self', 'archived', 'child', 'blank')
let workspace = { phase: 'ready', archivedSessionIds: ['archived'] }
let catalog = { ids, byId, phase: 'ready', projectionsBySession: {} }
const ctx = {
  inject: (_deps, activate) => activate(ctx),
  effect: activate => activate(),
  slots: { inject: () => {}, register: () => {} },
  commandUi: { register: spec => { command = spec } },
  inputTriggers: { registerSource: () => {} },
  sessions: { list: { getSnapshot: () => catalog } },
  workspaces: { list: { getSnapshot: () => workspace } },
  get: () => undefined,
}
client.apply(ctx)
assert.ok(command)
const options = await command.ui.options({ sessionId: 'self' }, new AbortController().signal)
assert.equal(options.length, 70)
// rc.5 popup substring search examines label and detail.
assert.match(options.find(row => row.id === 'session-069').detail, /session-069/)
assert.match(options.find(row => row.id === 'session-069').detail, /unique-ending/)
for (const excluded of ['self', 'archived', 'child', 'blank', 'retained']) {
  assert.equal(options.some(row => row.id === excluded), false)
}
workspace = { phase: 'pending', archivedSessionIds: [] }
assert.equal((await command.ui.options({ sessionId: 'self' }, new AbortController().signal)).length, 0)
workspace = { phase: 'ready', archivedSessionIds: ['archived'] }
catalog = { ...catalog, phase: 'pending' }
assert.equal((await command.ui.options({ sessionId: 'self' }, new AbortController().signal)).length, 0)

// Host list is discovery, marks forbidden targets, and admission rechecks archive state.
const hostTools = new Map()
const records = [
  { header: { id: 'self', createdAt: 1 } },
  { header: { id: 'selected', createdAt: 2 } },
  { header: { id: 'child', createdAt: 3, origin: 'subagent' } },
  { header: { id: 'blank', createdAt: 4 } },
]
const archive = []
const host = {
  tools: { register: tool => hostTools.set(tool.name, tool) },
  sessionQuery: { listSessions: async () => records, readSurface: async () => { readCount++; throw Error('unexpected read') } },
  sessions: { list: () => [] }, agents: { get: () => undefined },
  get: key => key === 'workspaceRegistry' ? { archivedSessionIds: archive } : undefined,
  sessionController: { prompt: async () => ({ accepted: true }) },
}
applyHost(host)
const exec = { callId: 'candidate-test', signal: new AbortController().signal, agent: { session: { id: 'self' } } }
archive.push('selected')
const listing = await hostTools.get('session_list').execute({}, exec)
assert.equal(listing.sessions.find(row => row.sessionId === 'selected').archived, true)
assert.equal(listing.sessions.find(row => row.sessionId === 'child').delegated, true)
assert.ok(listing.sessions.find(row => row.sessionId === 'blank'))
await assert.rejects(hostTools.get('session_send').execute({ target: 'selected', message: 'x' }, exec), /archived/)
await assert.rejects(hostTools.get('session_send').execute({ target: 'child', message: 'x' }, exec), /delegated/)
await assert.rejects(hostTools.get('session_send').execute({ target: 'self', message: 'x' }, exec), /cannot target/)
assert.equal((await hostTools.get('session_send').execute({ target: 'blank', message: 'x' }, exec)).accepted, true)
assert.equal(readCount, 0)
console.log('candidate picker: all assertions passed')

