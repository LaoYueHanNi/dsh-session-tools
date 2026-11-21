/**
 * Behavioural smoke test with a fake Cordis context (no harness runtime).
 * Run with: node tests/smoke.mjs
 */
import assert from 'node:assert/strict'
// Runs against the built Node half, which is what npm publishes.
import { apply } from '../lib/index.js'

const records = [
  { header: { id: 'session-a', createdAt: 1, cwd: '/work/a' } },
  { header: { id: 'session-b', createdAt: 2, cwd: '/work/b' } },
  { header: { id: 'session-c', createdAt: 3, cwd: '/work/c' } },
  { header: { id: 'session-dupe-1', createdAt: 4 } },
  { header: { id: 'session-dupe-2', createdAt: 5 } },
  { header: { id: 'session-child', createdAt: 6, origin: 'subagent', parentSession: 'session-a' } },
  { header: { id: 'session-self', createdAt: 0 } },
]

/** Surface-event fixtures in the shape `sessionQuery.readSurface` returns. */
const surfaces = new Map([
  ['session-a', [
    { type: 'user/message', seq: 0, time: 1000, data: { message: { role: 'user', content: [{ type: 'text', text: '第一条提问' }] } } },
    {
      type: 'assistant/message',
      seq: 1,
      time: 2000,
      data: {
        message: {
          role: 'assistant',
          content: [{ type: 'reasoning', text: '内部思考' }, { type: 'text', text: '第一条回答' }],
        },
      },
    },
    { type: 'tool/call', seq: 2, time: 2500, data: { turn: 0, step: 1, callId: 'c1', name: 'bash', arguments: '{}' } },
    { type: 'tool/result', seq: 3, time: 2600, data: { message: { role: 'tool', content: [{ type: 'text', text: '工具输出' }] } } },
    { type: 'assistant/message', seq: 4, time: 3000, data: { message: { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' }] } } },
    { type: 'user/message', seq: 5, time: 4000, data: { message: { role: 'user', content: [{ type: 'text', text: '[来自会话「session-self」(session-self)]\n\n继续' }] } } },
  ]],
  ['session-self', [
    { type: 'assistant/message', seq: 0, time: 500, data: { message: { role: 'assistant', content: [{ type: 'text', text: '自己的回答' }] } } },
  ]],
])

const titles = {
  'session-a': '研究记录',
  'session-b': '实现计划',
  'session-c': '发布检查',
  'session-dupe-1': '新对话',
  'session-dupe-2': '新对话',
  'session-child': 'reviewer',
}

const prompts = []
const delivered = []
const created = []
const workspaces = []
const renamed = []
const selections = []
const liveAgents = new Map()
const tools = new Map()

/** Directories the fake Workspace registry considers existing. */
const existingDirs = new Set([
  'D:/work/new',
  'D:/work/inherit',
  '/workspace/projects/alpha',
  '/workspace/projects/alpha-main-2',
  'D:/a/tools',
  'D:/b/tools',
  '/work/a',
])

/** Workspaces the fake registry already knows, as the sidebar would name them. */
const knownWorkspaces = [
  { id: 'workspace-known-1', path: '/workspace/projects/alpha', title: '项目甲' },
  { id: 'workspace-known-2', path: '/workspace/projects/alpha-main-2', title: '项目甲主分支' },
  { id: 'workspace-known-3', path: 'D:/a/tools', title: 'tools' },
  { id: 'workspace-known-4', path: 'D:/b/tools', title: 'tools 备用' },
]

/** Agent presets the fake roster lists, in registry order. */
const knownPresets = [
  { id: 'coder', name: '写代码助手', description: '为编码任务调整工具与提示' },
  { id: 'reviewer', name: '代码审阅', description: '偏重审阅与检查' },
  { id: 'writer', name: '写作', description: '面向文档写作' },
  { id: 'broken-preset', name: '坏预设', description: '注册后激活失败', broken: 'missing plugin: nope' },
]

/** Fake Agent preset registry; undefined simulates a deployment without a roster. */
let presetsService = { defaultId: 'coder', list: async () => knownPresets }

function liveAgent(id) {
  return {
    session: { id },
    model: {
      select: selection => selections.push({ id, selection }),
    },
    followup(message) {
      delivered.push({ id, mode: 'queue', message })
    },
    steer(message) {
      delivered.push({ id, mode: 'steer', message })
    },
  }
}

const ctx = {
  tools: {
    register(definition) {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
  },
  sessions: {
    list: () => records.map(record => ({ id: record.header.id })),
    flush: async () => true,
  },
  agents: {
    get: id => liveAgents.get(id),
  },
  get(service) {
    if (service === 'sessionProjections') {
      return {
        snapshot: session => ({ values: { title: titles[session.id] } }),
      }
    }
    if (service === 'workspaceRegistry') {
      return {
        create: async cwd => {
          workspaces.push(cwd)
          return { id: `workspace-${workspaces.length}` }
        },
        list: () => knownWorkspaces,
        resolveByPath: async path => {
          if (!existingDirs.has(path)) throw new Error(`no directory at ${path}`)
          return knownWorkspaces.find(workspace => workspace.path === path)
        },
      }
    }
    if (service === 'sessionTitle') {
      return {
        rename: (session, title) => {
          renamed.push({ id: session.id, title })
        },
      }
    }
    if (service === 'agentPresets') {
      return presetsService
    }
    return undefined
  },
  sessionQuery: {
    listSessions: async () => records,
    readSurface: async sessionId => {
      const events = surfaces.get(sessionId)
      if (events === undefined) throw new Error(`session "${sessionId}" cannot be read`)
      return {
        session: { id: sessionId },
        inheritedEventCount: 0,
        capturedThroughSeq: events.at(-1)?.seq ?? null,
        events,
      }
    },
  },
  sessionController: {
    prompt: async request => {
      prompts.push(request)
      return { accepted: true }
    },
    create: async options => {
      created.push(options)
      return { sessionId: `session-new-${created.length}` }
    },
    modelCatalog: async () => ({
      default: { provider: 'remote-magpie/deepseek', model: 'deepseek-v5', reasoningEffort: 'medium' },
      routableProviders: ['remote-magpie/deepseek', 'remote-magpie/zhipu', 'alibaba/qwen'],
      groups: [
        { id: 'remote-magpie/deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v5', name: 'DeepSeek V5' }] },
        {
          id: 'remote-magpie/zhipu',
          name: 'Zhipu',
          models: [
            {
              id: 'glm-5.3',
              name: 'GLM 5.3',
              reasoning: { efforts: [{ id: 'high' }, { id: 'medium' }, { id: 'low' }], defaultEffort: 'medium' },
            },
            { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash' },
          ],
        },
        {
          id: 'alibaba/qwen',
          name: 'Qwen',
          models: [
            { id: 'qwen-dsv4.1', name: 'Qwen DSV 4.1', reasoning: { efforts: [{ id: 'high' }, { id: 'low' }] } },
            { id: 'remote-magpie/qwen-token-plan/qwen4-max', name: 'Qwen4 Max (routed)' },
          ],
        },
      ],
      failures: [],
    }),
  },
}

apply(ctx)

const list = tools.get('session_list')
const models = tools.get('session_models')
const presets = tools.get('session_presets')
const send = tools.get('session_send')
const create = tools.get('session_create')
const read = tools.get('session_read')
assert.ok(list, 'session_list registered')
assert.ok(models, 'session_models registered')
assert.ok(presets, 'session_presets registered')
assert.ok(send, 'session_send registered')
assert.ok(create, 'session_create registered')
assert.ok(read, 'session_read registered')

const exec = (callId = 'call-1') => ({ callId, signal: new AbortController().signal, agent: { session: { id: 'session-self' } } })

// list: excludes the caller, marks the delegated child, exposes titles
const all = await list.execute({}, exec())
assert.equal(all.total, 6)
assert.equal(all.sessions.length, 6)
assert.equal(all.sessions[0].title, '研究记录')
assert.equal(all.sessions.find(row => row.sessionId === 'session-child').delegated, true)
assert.equal(all.sessions.find(row => row.sessionId === 'session-c').cwd, '/work/c')

// list: query filter across title, id, and cwd
const filtered = await list.execute({ query: '研究' }, exec())
assert.deepEqual(filtered.sessions.map(row => row.sessionId), ['session-a'])

// models: flattens the catalog into routes with efforts and the default selection
const routes = await models.execute({}, exec('call-models'))
assert.equal(routes.total, 5)
assert.deepEqual(routes.default, { provider: 'remote-magpie/deepseek', model: 'deepseek-v5', reasoningEffort: 'medium' })
const glm = routes.models.find(row => row.model === 'glm-5.3')
assert.deepEqual(glm, {
  provider: 'remote-magpie/zhipu',
  model: 'glm-5.3',
  name: 'GLM 5.3',
  efforts: ['high', 'medium', 'low'],
  defaultEffort: 'medium',
})
const flashRoute = routes.models.find(row => row.model === 'glm-5.3-flash')
assert.equal(flashRoute.efforts, undefined)
assert.equal(flashRoute.defaultEffort, undefined)
assert.equal((await list.execute({ query: 'work/b' }, exec())).sessions[0].sessionId, 'session-b')
assert.equal((await list.execute({ query: 'session-c' }, exec())).sessions[0].sessionId, 'session-c')

// list: limit and malformed limit fall back
assert.equal((await list.execute({ limit: 2 }, exec())).shown, 2)
assert.equal((await list.execute({ limit: 'nope' }, exec())).shown, 6)

// send cold: an unloaded Session goes through the controller prompt path
const cold = await send.execute({ target: '研究记录', message: '请继续' }, exec('call-title'))
assert.equal(cold.delivery, 'user')
assert.equal(prompts.at(-1).sessionId, 'session-a')
assert.equal(prompts.at(-1).mode, 'queue')
assert.match(prompts.at(-1).content[0].text, /请继续$/)
assert.match(prompts.at(-1).content[0].text, /^\[来自会话「session-self」\(session-self\)\]/)
assert.doesNotMatch(prompts.at(-1).content[0].text, /回报方式/)
assert.equal(prompts.at(-1).requestId, 'session-send:call-title:session-a')

// send cold: steer mode passes through
await send.execute({ target: 'session-b', message: '插一句', mode: 'steer' }, exec('call-steer'))
assert.equal(prompts.at(-1).mode, 'steer')

// send: reply adds the return address, so the target answers with session_send
await send.execute({ target: 'session-b', message: '做完回我', reply: true }, exec('call-reply'))
assert.equal(
  prompts.at(-1).content[0].text,
  '[来自会话「session-self」(session-self)]\n\n做完回我\n\n'
  + '[回报方式：完成后用 session_send 把结果发给「session-self」(session-self)。发完即结束，不要等待或轮询。]',
)

// send hot: a loaded Agent receives a handoff source through its inbox
liveAgents.set('session-c', liveAgent('session-c'))
const hot = await send.execute({ target: '发布检查', message: '热投递' }, exec('call-hot'))
assert.equal(hot.delivery, 'relay')
assert.equal(delivered.at(-1).id, 'session-c')
assert.equal(delivered.at(-1).mode, 'queue')
assert.equal(delivered.at(-1).message.source.kind, 'session-handoff')
assert.equal(delivered.at(-1).message.source.form, 'relay')
assert.equal(delivered.at(-1).message.source.senderSessionId, 'session-self')
assert.match(delivered.at(-1).message.content[0].text, /热投递$/)

// send hot: steer mode reaches the Agent's steering lane
await send.execute({ target: 'session-c', message: '打断一下', mode: 'steer' }, exec('call-hot-steer'))
assert.equal(delivered.at(-1).mode, 'steer')

// send: ambiguous title reports candidates
await assert.rejects(
  send.execute({ target: '新对话', message: 'x' }, exec('call-dupe')),
  /matches 2 Sessions.*新对话 \(session-dupe-1\).*新对话 \(session-dupe-2\)/,
)

// send: self is rejected
await assert.rejects(send.execute({ target: 'session-self', message: 'x' }, exec()), /cannot target the Session that is calling it/)

// send: delegated child is rejected
await assert.rejects(send.execute({ target: 'session-child', message: 'x' }, exec()), /delegated subagent Session/)

// send: unknown target is rejected
await assert.rejects(send.execute({ target: '不存在的会话', message: 'x' }, exec()), /No Session matches target/)

// send: empty message and bad mode are rejected
await assert.rejects(send.execute({ target: 'session-a', message: '   ' }, exec()), /non-empty message/)
await assert.rejects(send.execute({ target: 'session-a', message: 'x', mode: 'now' }, exec()), /must be "queue" or "steer"/)

// create: registers the directory as a Workspace, names the Session, and hands it the message
liveAgents.set('session-new-1', liveAgent('session-new-1'))
const made = await create.execute({
  cwd: 'D:/work/new',
  title: '新任务',
  message: '开工',
}, exec('call-create'))
assert.equal(made.sessionId, 'session-new-1')
assert.equal(made.title, '新任务')
assert.equal(made.cwd, 'D:/work/new')
assert.equal(made.delivered, true)
assert.deepEqual(workspaces, ['D:/work/new'])
assert.deepEqual(created.at(-1), { workspaceId: 'workspace-1' })
assert.deepEqual(renamed.at(-1), { id: 'session-new-1', title: '新任务' })
assert.equal(delivered.at(-1).id, 'session-new-1')
assert.equal(delivered.at(-1).message.source.kind, 'session-handoff')
assert.equal(delivered.at(-1).message.source.senderSessionId, 'session-self')
assert.match(delivered.at(-1).message.content[0].text, /^\[来自会话「session-self」\(session-self\)\]\n\n开工$/)

// create: a blank creation is refused, because such a Session never reaches the sidebar
await assert.rejects(
  create.execute({ title: '空会话' }, exec('call-create-bare')),
  /requires a non-empty message/,
)
assert.equal(workspaces.length, 1)

// create: a Session whose Agent is not loaded still gets its first message through the prompt path
const coldNew = await create.execute({ title: '冷会话', message: '喂' }, exec('call-create-cold'))
assert.equal(coldNew.sessionId, 'session-new-2')
assert.equal(coldNew.delivered, true)
assert.equal(prompts.at(-1).sessionId, 'session-new-2')
assert.match(prompts.at(-1).content[0].text, /喂$/)
assert.equal(renamed.length, 1)

// create: reply asks the new Session to report back to the creating Session
liveAgents.set('session-new-3', liveAgent('session-new-3'))
const reporting = await create.execute({ title: '回报任务', message: '做完告诉我', reply: true }, exec('call-create-reply'))
assert.equal(reporting.sessionId, 'session-new-3')
assert.equal(reporting.delivered, true)
assert.match(delivered.at(-1).message.content[0].text, /^\[来自会话「session-self」\(session-self\)\]\n\n做完告诉我/)
assert.match(delivered.at(-1).message.content[0].text, /回报方式：完成后用 session_send 把结果发给「session-self」\(session-self\)/)

// create: an omitted cwd inherits the calling Session directory, not the profile
liveAgents.set('session-new-4', liveAgent('session-new-4'))
const inherited = await create.execute({ title: '继承目录', message: '开工' }, {
  callId: 'call-create-inherit',
  signal: new AbortController().signal,
  agent: { session: { id: 'session-self', header: { cwd: 'D:/work/inherit' } } },
})
assert.equal(inherited.cwd, 'D:/work/inherit')
assert.deepEqual(created.at(-1), { workspaceId: 'workspace-2' })

// read: projects only text-bearing user and assistant rows, oldest first
const transcript = await read.execute({ target: '研究记录' }, exec('call-read'))
assert.equal(transcript.sessionId, 'session-a')
assert.equal(transcript.title, '研究记录')
assert.deepEqual(transcript.messages.map(row => row.seq), [0, 1, 5])
assert.deepEqual(transcript.messages.map(row => row.role), ['user', 'assistant', 'user'])
assert.equal(transcript.messages[1].text, '第一条回答')
assert.equal(transcript.total, 3)
assert.equal(transcript.shown, 3)
assert.equal(transcript.truncated, false)

// read: a limit keeps the newest rows and reports the truncation
const tail = await read.execute({ target: 'session-a', limit: 2 }, exec('call-read-tail'))
assert.deepEqual(tail.messages.map(row => row.seq), [1, 5])
assert.equal(tail.total, 3)
assert.equal(tail.shown, 2)
assert.equal(tail.truncated, true)

// read: role filter narrows the projection
const onlyUser = await read.execute({ target: 'session-a', roles: ['user'] }, exec('call-read-user'))
assert.deepEqual(onlyUser.messages.map(row => row.seq), [0, 5])
assert.equal(onlyUser.total, 2)

// read: reading the calling Session is allowed
const own = await read.execute({ target: 'session-self' }, exec('call-read-self'))
assert.equal(own.sessionId, 'session-self')
assert.equal(own.shown, 1)

// read: unknown, ambiguous, and unreadable targets are rejected
await assert.rejects(read.execute({ target: '不存在的会话' }, exec()), /No Session matches target/)
await assert.rejects(read.execute({ target: '新对话' }, exec()), /matches 2 Sessions/)
await assert.rejects(read.execute({ target: '实现计划' }, exec()), /Cannot read Session "实现计划"/)

// create: a spoken Workspace title resolves to its directory
const spoken = await create.execute({ cwd: '项目甲', title: '称谓建会话', message: '开工' }, exec('call-create-spoken'))
assert.equal(spoken.cwd, '/workspace/projects/alpha')
assert.equal(workspaces.at(-1), '/workspace/projects/alpha')

// create: a directory last segment resolves even when the user names it without the title
const bySegment = await create.execute({ cwd: 'alpha main 2', title: '尾段建会话', message: '开工' }, exec('call-create-segment'))
assert.equal(bySegment.cwd, '/workspace/projects/alpha-main-2')

// create: a multi-segment suffix resolves against the known path
const bySuffix = await create.execute({ cwd: 'projects/alpha', title: '后缀建会话', message: '开工' }, exec('call-create-suffix'))
assert.equal(bySuffix.cwd, '/workspace/projects/alpha')

// create: a Session title the user named resolves to that Session's directory
const bySession = await create.execute({ cwd: '研究记录', title: '会话名建会话', message: '开工' }, exec('call-create-by-session'))
assert.equal(bySession.cwd, '/work/a')

// create: an ambiguous name reports candidates instead of guessing
await assert.rejects(
  create.execute({ cwd: 'tools', title: '歧义', message: '开工' }, exec('call-create-ambiguous')),
  /matches 2 known directories: D:\/a\/tools, D:\/b\/tools/,
)

// create: an unknown name lists what the Host knows and offers the inherited directory
await assert.rejects(
  create.execute({ cwd: '不存在的项目', message: '开工' }, {
    callId: 'call-create-missing',
    signal: new AbortController().signal,
    agent: { session: { id: 'session-self', header: { cwd: 'D:/work/inherit' } } },
  }),
  /is neither an existing directory nor a known Workspace or Session directory.*Known directories:.*Omit cwd to use the calling Session directory \(D:\/work\/inherit\)/s,
)

// create: an existing relative directory still wins without any name matching
const relative = await create.execute({ cwd: 'inherit', title: '相对路径', message: '开工' }, {
  callId: 'call-create-relative',
  signal: new AbortController().signal,
  agent: { session: { id: 'session-self', header: { cwd: 'D:/work' } } },
})
assert.equal(relative.cwd, 'D:/work/inherit')
assert.equal(relative.delivered, true)

// create: a named model is validated, recorded on the new Session, and echoed back
liveAgents.set('session-new-10', liveAgent('session-new-10'))
const modeled = await create.execute({
  title: '模型会话',
  message: '开工',
  provider: 'remote-magpie/zhipu',
  model: 'glm-5.3',
  reasoningEffort: 'high',
}, exec('call-create-model'))
assert.equal(modeled.sessionId, 'session-new-10')
assert.equal(modeled.model, 'remote-magpie/zhipu/glm-5.3 @ high')
assert.deepEqual(selections.at(-1), {
  id: 'session-new-10',
  selection: { provider: 'remote-magpie/zhipu', model: 'glm-5.3', reasoningEffort: 'high' },
})
// the selection is recorded before the first message is delivered
assert.equal(delivered.at(-1).id, 'session-new-10')

// create: a model without reasoning efforts still accepts a bare route
liveAgents.set('session-new-11', liveAgent('session-new-11'))
const flash = await create.execute({ message: '快跑', provider: 'remote-magpie/zhipu', model: 'glm-5.3-flash' }, exec('call-create-flash'))
assert.equal(flash.model, 'remote-magpie/zhipu/glm-5.3-flash')
assert.deepEqual(selections.at(-1).selection, { provider: 'remote-magpie/zhipu', model: 'glm-5.3-flash' })

// create: an unsupported reasoning effort is rejected before anything is created
const createdBeforeModels = created.length
await assert.rejects(
  create.execute({
    message: '开工',
    provider: 'alibaba/qwen',
    model: 'qwen-dsv4.1',
    reasoningEffort: 'weird',
  }, exec('call-create-effort')),
  /reasoning effort "weird" is not supported by "alibaba\/qwen\/qwen-dsv4\.1"\. Supported efforts: high, low/,
)
assert.equal(created.length, createdBeforeModels)

// create: an unknown model route fails with the catalog attached and costs nothing
await assert.rejects(
  create.execute({ message: '开工', provider: 'remote-magpie/zhipu', model: 'glm-9' }, exec('call-create-unknown-model')),
  /model "remote-magpie\/zhipu\/glm-9" is not in the model catalog\..*Default: provider=remote-magpie\/deepseek model=deepseek-v5 @ medium\..*provider=remote-magpie\/zhipu model=glm-5\.3.*Call session_create again with an exact provider and model id/s,
)
assert.equal(created.length, createdBeforeModels)

// create: a slash-bearing model id stays unambiguous in the rendered catalog
await assert.rejects(
  create.execute({ message: '开工', provider: 'remote-magpie/zhipu', model: 'glm-9' }, exec('call-create-slash-model')),
  /provider=alibaba\/qwen model=remote-magpie\/qwen-token-plan\/qwen4-max/,
)

// create: half a route is refused outright
await assert.rejects(
  create.execute({ message: '开工', model: 'glm-5.3' }, exec('call-create-half-route')),
  /provider and model together/,
)

// create: an omitted effort reuses the user's last manual selection when the model matches the Host default
liveAgents.set('session-new-12', liveAgent('session-new-12'))
const defaulted = await create.execute({
  message: '开工',
  provider: 'remote-magpie/deepseek',
  model: 'deepseek-v5',
}, exec('call-create-default-effort'))
assert.equal(defaulted.model, 'remote-magpie/deepseek/deepseek-v5 @ medium')
assert.deepEqual(selections.at(-1), {
  id: 'session-new-12',
  selection: { provider: 'remote-magpie/deepseek', model: 'deepseek-v5', reasoningEffort: 'medium' },
})

// create: a different model falls back to the provider's recommended default effort
liveAgents.set('session-new-13', liveAgent('session-new-13'))
const recommended = await create.execute({ message: '开工', provider: 'remote-magpie/zhipu', model: 'glm-5.3' }, exec('call-create-recommended-effort'))
assert.equal(recommended.model, 'remote-magpie/zhipu/glm-5.3 @ medium')
assert.equal(selections.at(-1).selection.reasoningEffort, 'medium')

// presets: flattens the roster with the default mark and the activation failure
const roster = await presets.execute({}, exec('call-presets'))
assert.equal(roster.total, 4)
assert.deepEqual(roster.presets[0], {
  id: 'coder',
  name: '写代码助手',
  description: '为编码任务调整工具与提示',
  isDefault: true,
})
const brokenPreset = roster.presets.find(row => row.id === 'broken-preset')
assert.equal(brokenPreset.broken, 'missing plugin: nope')
assert.equal(brokenPreset.isDefault, undefined)

// create: an exact preset id passes through and is echoed back
const coded = await create.execute({ message: '开工', agentPreset: 'reviewer' }, exec('call-create-preset-id'))
assert.equal(coded.preset, 'reviewer')
assert.deepEqual(created.at(-1), { agentPreset: 'reviewer' })

// create: a spoken preset name resolves through the roster display names
const spokenPreset = await create.execute({ message: '开工', agentPreset: '写代码 助手' }, exec('call-create-preset-name'))
assert.equal(spokenPreset.preset, 'coder')
assert.equal(created.at(-1).agentPreset, 'coder')

// create: a partially spoken preset name resolves when it is unique
const partialPreset = await create.execute({ message: '开工', agentPreset: '代码审' }, exec('call-create-preset-partial'))
assert.equal(partialPreset.preset, 'reviewer')

// create: an ambiguous preset name lists candidates instead of guessing
await assert.rejects(
  create.execute({ message: '开工', agentPreset: '代码' }, exec('call-create-preset-ambiguous')),
  /agent preset "代码" matches 2 presets: coder \(写代码助手\), reviewer \(代码审阅\)\. Call session_create again with one preset id\./,
)

// create: an unknown preset fails with the roster attached and costs nothing
const createdBeforePresets = created.length
await assert.rejects(
  create.execute({ message: '开工', agentPreset: '翻译' }, exec('call-create-preset-missing')),
  /agent preset "翻译" is not in the preset roster\. Default: coder\. Available: id=coder name=写代码助手 \(default\); id=reviewer name=代码审阅; id=writer name=写作; id=broken-preset name=坏预设 \(broken\)\. Call session_create again with an exact preset id; session_presets lists this roster with descriptions\./,
)
assert.equal(created.length, createdBeforePresets)

// create: a preset id that exists but is broken reports why it cannot run
await assert.rejects(
  create.execute({ message: '开工', agentPreset: 'broken-preset' }, exec('call-create-preset-broken')),
  /agent preset "broken-preset" is currently unavailable: missing plugin: nope/,
)

// create: a spoken name never resolves onto a broken preset
await assert.rejects(
  create.execute({ message: '开工', agentPreset: '坏预设' }, exec('call-create-preset-broken-name')),
  /agent preset "坏预设" is not in the preset roster\..*id=broken-preset name=坏预设 \(broken\)/s,
)

// create: a named preset without a roster is refused instead of silently dropped
presetsService = undefined
await assert.rejects(
  create.execute({ message: '开工', agentPreset: 'coder' }, exec('call-create-preset-no-roster')),
  /composes no Agent preset roster.*Omit agentPreset/s,
)
// presets: an empty roster answers without failing
assert.deepEqual(await presets.execute({}, exec('call-presets-empty')), { presets: [], total: 0 })

// create: an omitted preset stays omitted, with or without a roster
const presetless = await create.execute({ message: '开工' }, exec('call-create-preset-omitted'))
assert.equal(presetless.delivered, true)
assert.equal(presetless.preset, undefined)
assert.equal('agentPreset' in created.at(-1), false)
presetsService = { defaultId: 'coder', list: async () => knownPresets }
const defaultedPreset = await create.execute({ message: '开工' }, exec('call-create-preset-default'))
assert.equal(defaultedPreset.delivered, true)
assert.equal('agentPreset' in created.at(-1), false)


console.log('smoke: all assertions passed')
