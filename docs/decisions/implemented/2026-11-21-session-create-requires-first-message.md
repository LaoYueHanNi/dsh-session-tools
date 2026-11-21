# DR: `session_create` 要求首条消息，拒绝创建侧边栏不可见的空会话

Status: implemented

## Problem

实测确认：`session_create` 创建一个零事件的会话后，Host 侧一切正常——Workspace 归属写进了 `workspaceRegistry`、日志落盘、`sessionQuery.listSessions` 能查到——但 DSH 侧边栏不列出它。只有当这个会话收到第一条消息、产生了事件之后，它才出现在侧边栏里。

原因在客户端：侧边栏的会话行来自浏览器侧的会话目录。原生「新建会话」按钮走客户端 `sessions.create()`，客户端在解析前就把这一行 publish 进自己的目录；而 Host 工具的创建路径没有这一步，Host 侧也没有「让客户端插入一行」的接口。于是本插件建出的空壳对用户不可见、不可点，等于凭空产生一个用户永远够不着的会话。

## Decision

`session_create` 的 `message` 改为必填：参数 schema 的 `required` 包含它，执行时对空白内容抛错，工具描述与参数描述都写明原因。首消息仍走 `deliverToSession` 的同一条交接路径（Agent 在线进收件箱并带 `session-handoff` 来源，离线退回 controller 的 `prompt`），因此新建会话必定拥有事件，也就必定拥有侧边栏行。空会话改用侧边栏的「新建会话」按钮，那走客户端路径。

顺带移除「Agent 未加载就不投递」的分支：既然 message 必填，投递就必须发生，`deliverToSession` 自己会处理冷会话。

## Alternatives considered

- **创建后自动补一条占位首消息** —— 输在会往用户的会话里塞一条无意义内容并触发一个模型回合，用户还得手动清理。
- **创建后调用 `workspaceRegistry.pinSession` 置顶** —— 未验证能否绕过侧边栏的可见性规则；即使有效，代价是会话被置顶、用户还得手动取消，而且 pin 表达的是排序而非可见性。
- **保持可选，只在描述里警告** —— 输在警告会被模型忽略，空壳照旧出现，用户照旧看不到。
- **在 Host 侧主动 emit `api-session/added`** —— DSH 本来就在 `session/created` 时发过这个事件，客户端仍不显示，说明缺的是客户端的目录发布而不是事件，重复 emit 无济于事。

## Consequences

- 代价：破坏性变更——原来可以只传 `cwd` / `title` 建空壳，现在会报错；冒烟测试里「无首消息创建成功」与「冷会话不投递」两条用例随之改写。需要空会话的场景转移到侧边栏按钮。
- 换来：`session_create` 的返回结果与用户能看到的东西严格一致——只要它返回了 `sessionId`，那个会话就一定能被打开；`delivered` 不再有 `false` 的可能，创建即交接。