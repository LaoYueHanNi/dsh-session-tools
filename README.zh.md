# dsh-session-tools

简体中文 | [English](./README.md)

DeepSeek Harness 的本地插件：给模型**六个跨会话消息**，并在 `/` 菜单里给你一个「**会话消息**」入口（英文界面显示 Session message）。

- `session_list` — 按标题 / id / 工作目录查找可发消息的会话
- `session_models` — 列出新会话可用的模型路由（provider、model、显示名、思考档位、默认选择），指定前先查
- `session_presets` — 列出新会话可用的 Agent 预设（id、显示名、描述、默认标记），指定前先查
- `session_send` — 向指定会话投递一条消息；单向投递，**发出即结束**，`reply: true` 时让对方把结果发回来
- `session_read` — 仅在用户明确要求时，读取某个会话最近的用户 / 助手消息
- `session_create` — 新建会话（可指定目录 / 标题 / Agent 预设 / 模型路由），并附一条首消息
- **「会话消息」**（`/` 菜单，带图标）— 选一个会话，输入框里插入一个**会话 chip**（和 `@` 引用同款样式）；你接着写的是**给模型的指令**，chip 在提交时序列化成 `[目标会话：<标题>]`，模型据此组织内容并调用 `session_send`

没有"原样直发"的命令行通道：要一字不改地发，直接去那个会话里说就行。

## 安装

```sh
dsh plugin --profile <name> add @laoyuehanni/dsh-session-tools
```

包内声明了 `dsh.bundle`，安装时会自动加入 profile 的 bundle 栈，无需手改 profile。装完重启 profile（或重载插件）。

验证：让模型"列一下可以发消息的会话"（`session_list`），再"给某某会话发：……"（`session_send`）。你自己在输入框敲 `/` 就能看到「会话消息」这一行。

## 工具

| 工具 | 作用 | 模型什么时候该用 |
|---|---|---|
| `session_list` | 列出可见会话：id、标题、cwd、创建时间、归档 / 子代理标记 | 用户用自然语言提到某个会话时，先定位它 |
| `session_models` | 列出本 Host 可在新会话运行的全部模型路由，含显示名、思考档位与默认选择 | `session_create` 要指定模型 / 档位之前，或用户问有哪些模型时 |
| `session_presets` | 列出本 Host 可在新会话运行的全部 Agent 预设，含显示名、描述与默认标记 | `session_create` 要指定预设之前，或用户随口提到某个预设时 |
| `session_send` | 把一条消息投递进另一个会话的收件箱 | 把活分给另一个会话，或回复一个把活分过来的会话 |
| `session_read` | 投影某个会话最近的 `user` / `assistant` 文本行 | 仅当用户要看那个会话说了什么——**绝不**用于跟进自己发出的消息 |
| `session_create` | 先把目录注册成 Workspace，再在其中建会话，可选设标题与模型路由（先对照实时目录校验），并投递必填的首消息 | 把独立的工作挪进自己的会话（另一个 checkout、另一个插件目录） |

目标解析顺序：精确 id → 精确标题 → 忽略大小写的子串。标题有歧义时返回候选而不是猜。向自己、向子代理会话、向已归档会话发送都会被拒绝并说明原因。

`session_create` 的目录有三种给法：绝对路径、相对发起会话的路径，或者用户嘴里那个名字——Workspace 标题、目录末级段（如 `alpha`），或某个会话的标题。名字按本 Host 已登记的 Workspace 与可见会话目录匹配；命中多个时列出候选拒绝猜测，一个都不命中时列出已知目录。

它的 `message` 是必填的。零事件的会话在侧边栏不占行，不给首消息就创建出一个用户看不到、也点不进去的东西，所以工具直接拒绝；空会话请走侧边栏的「新建会话」按钮。

可选的模型路由指定新会话跑哪个模型：`provider` 与 `model` 一起传（`session_models` 会列出精确 id 与思考档位），可选 `reasoningEffort`。选择在首条消息投递之前写入，且**绝不会改动你的全局默认模型**。省略 `reasoningEffort` 时按已知信息补全：指定的模型若正是你在 GUI 最后一次手动切换选中的模型，就沿用那次手选的档位；否则用该模型 provider 声明的推荐档。

可选的 `agentPreset` 指定新会话跑哪个 Agent 预设：可以传精确 id，也可以传你嘴里那个称呼（「用那个写代码的预设」）。称呼在创建任何东西之前按预设名册的显示名解析（`session_presets` 列出名册）；命中多个时返回候选，一个不命中时返回完整名册，省略则用配置的默认预设。在没有预设名册的 Host 上指名预设会被明确拒绝，而不是被悄悄丢弃。

## 投递模型

投递是**单向、发完即结束**的。消息一送达，发起方这部分就结束了，无论对方是否回复；发起方之后不得读取或轮询目标。

结果重要时设 `reply: true`，插件会在正文末尾追加回信地址：

```
[来自会话「<发送方标题>」(<发送方 id>)]

<正文>

[回报方式：完成后用 session_send 把结果发给「<发送方标题>」(<发送方 id>)。发完即结束，不要等待或轮询。]
```

接收方用 `session_send` 发回即可，回信像普通消息一样进入发起方会话。两边都不需要读对方、也不需要轮询。

两条投递路径，自动选择：

- **热会话** — 已加载的 Agent 通过收件箱收到消息，`source.kind = 'session-handoff'`，Web 端据此在消息上方标注"收到消息，来自 …"。用 `ctx.sessions.flush` 确认落盘后才返回。
- **冷会话** — 没有 Agent 可寻址，退回 `ctx.sessionController.prompt`（普通 `user` source）。消息照样送达并唤醒会话，只是没有来源徽标。

## 「会话消息」用法

1. 输入 `/`，选「会话消息」。
2. 在列表里选一个会话（可搜索；每行显示目录尾段和相对活跃时间）。
3. 会话 chip 插入在**光标处，不覆盖**你已经输入的任何文字。
4. 接着写你的指令，例如"把接口变更同步给它，要它重新生成文档"。
5. 提交时 chip 变成 `[目标会话：<标题>]`；模型读到这个标记，组织真正的正文并调用 `session_send`。

这个标记**刻意不是** `@[label](dsh-session:…)`：那个 URI 会让内置的 `session-reference` 插件注入目标会话的只读快照。方括号标记只是普通上下文，不会在背后读取任何会话内容。

## 环境要求

- DeepSeek Harness `0.2.2-rc.5`（本包类型检查所对齐的版本）
- Node `>= 22.19`
- Web profile（Client 半面向 `platform: web`）

**零运行时依赖**：所有 `@deepseek-ai/*` 引用都是 `import type`，浏览器 bundle 的 React 与 Cordis 由 web shell 的冻结模块表提供。

## 配置

无。插件只注册六个工具和两个浏览器贡献，不读取任何配置。

## 实现要点

- **标题** 来自会话投影（`sessionProjections`，冷会话用可选的 `sessionProjectionCache`），不折叠日志，避免列表调用变慢。
- **归档 / 子代理判断** 读取 `workspaceRegistry.archivedSessionIds` 与会话头的 `origin`。
- **新建会话**：先把 `cwd` 解析成真实存在的目录（优先 `workspaceRegistry.resolveByPath`，退回 `stat`）。参数不是目录时，按名字与 `workspaceRegistry.list()` 的标题/路径、以及可见会话的 `cwd` 匹配——分隔符、大小写与前后空格/下划线/连字符都归一化，所以口语名会落到侧边栏显示的那个目录。随后把目录注册成 Workspace（`workspaceRegistry.create`），再用 `workspaceId` 建会话——只传 `cwd` 建出来的会话不属于任何 Workspace，不会出现在侧边栏。省略 `cwd` 时继承调用方会话的目录；标题在 Agent 已加载时通过 `sessionTitle.rename` 设置，失败不视为错误。首消息是必填的，并走与 `session_send` 相同的交接路径，因此新会话必定拥有事件、也就必定拥有侧边栏行。可选的 `provider` / `model` / `reasoningEffort` 路由先对照 `sessionController.modelCatalog()` 校验（会话尚未创建，miss 零成本并附上完整目录），再在首条消息投递前经 `agent.model.select()` 写入——只给该会话追加一条 `model/selection` 事件，绝不触碰全局默认模型。可选的 `agentPreset` 同样在创建前对照 `agentPresets` 名册解析：精确 id 优先，其次对可用预设的显示名做归一化匹配（先精确、后包含），歧义列候选、miss 附全名册；无名册的部署指名预设会被拒绝而非静默丢弃。
- **读取会话**：`sessionQuery.readSurface(id)` 返回目标会话当前模型面，插件从中只投影 `user/message` 与 `assistant/message` 的 `text` 块——推理、图片、文件、工具调用与工具结果都不进结果。单条正文上限 4000 字，超出截断加省略号。
- **会话 chip** 是一个 `appearance: 'session'` 的 `ReferenceInsert`。它的序列化由插件自己注册的 trigger source（`codec.serialize`）负责，产出方括号标记。编辑器拒绝 chip 时，回退为把同样的标记以纯文本追加到已有草稿之后。

## 已知限制

- **输入框里的 chip，在发出的消息里是纯文本。** chip 只存在于编辑器；提交时按 `codec.serialize()` 变成文本写进消息，DSH 原生 `@` 引用同理。要在气泡里渲染 chip 只能替换 `conversation.chat.node` 的用户节点渲染器，会连带覆盖图片与状态渲染，故不做。
- **选择面板的 `detail` 槽是左对齐的**（共享 `popupSelect` 外壳），所以目录与活跃时间只能合并成右侧一段，无法做成两端对齐的两列。
- **不保留会话关系。** 插件不记"谁给谁发过、为什么"。入站来源只以 `[来自会话「…」(id)]` 信封留在那个会话自己的历史里；上下文压缩之后，模型可能已经不知道自己创建过某个会话。需要时用 `session_list` 重新认一遍。

## 开发

```sh
pnpm install
pnpm run typecheck        # tsc --noEmit
pnpm run build:all        # tsc -> lib/，再用 tsdown -> lib/client.js
pnpm run check:decisions  # 决策记录校验
pnpm test                 # node tests/smoke.mjs，跑的是 lib/ 产物
```

`lib/` 是构建产物，不入库；`prepublishOnly` 在每次发布前跑类型检查、决策记录校验、构建和测试。

非平凡变更必须在 [`docs/decisions/`](./docs/decisions) 留一条决策记录——格式与生命周期规则见它的 [README](./docs/decisions/README.md)，插件详情页文案见 [`docs/DETAIL.md`](./docs/DETAIL.md)，逐版本说明见 [`docs/releases/`](./docs/releases)。

## 许可

MIT