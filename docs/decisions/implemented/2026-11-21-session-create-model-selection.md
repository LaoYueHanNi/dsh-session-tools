# DR: `session_create` 支持指定模型，写入会话日志而不动全局默认

Status: implemented

## Problem

用户说「用 glm5.3 开个会话」时，调用模型没有任何途径满足这句话：`SessionCreateRequest` 只收 `workspaceId` / `cwd` / `sessionId` / `agentPreset`，创建时带不了模型；`agentPreset` 是整套预设（工具集、系统提示），只为选模型而要求建预设过重。

Host 侧其实有两条写模型的路径，但各有取舍：官方的 `sessionController.selectModel` 在给会话记录选择的同时，还会把该模型**保存为全局默认**（`agentDefaultModel.saveSelection`，与 GUI 手动切换的行为一致）；`agent.model.select` 只往目标会话自己的日志追加一条 `model/selection` 事件，但它是 Agent 上的底层入口，没有校验。

## Decision

`session_create` 增加可选三参 `provider` / `model` / `reasoningEffort`，口语名（"glm5.3"、"qwen-dsv4.1"）到精确 id 的解析交给调用模型，插件不做名称匹配。执行顺序：

1. **目录校验前置**：创建任何东西之前，用 `sessionController.modelCatalog()` 校验 `provider/model` 存在、`reasoningEffort`（显式指定或补全后）属于该模型支持档位；模型没有档位时显式档位会在创建前失败。miss 直接报错并附上完整目录（含全局默认），模型一次重试即可命中——失败分文未花，不留半成品。目录与 GUI 模型选择器同源，`groups` 已排除无可用模型的 provider，命中即可路由。目录渲染为逐条 `provider=<id> model=<id>` 键值行而不是 `provider/model` 拼接：model id 自身可含斜杠（实测 `magpie-anthropic` 下的 `remote-magpie/minimax-cn/MiniMax-M3.1-Flash`），拼接后调用方无法唯一拆分。
2. **选择写入在创建之后、首条消息投递之前**：`ctx.agents.get(sessionId).model.select(...)` 追加 `model/selection` 事件，新会话的第一个模型回合就跑在指定路由上。省略 `reasoningEffort` 时按已知信息补全：DSH 不按模型记忆档位，全局只有一份 `agentDefaultModel.currentSelection()`（用户最后一次 GUI 手动切换的 provider/model/effort 三元组）——当它的路由与请求一致时，其 effort 就是「用户上次在这个模型上手选的档位」，直接沿用；否则用目录里该模型 `reasoning.defaultEffort`（provider 推荐档）；两者皆无则保持省略，首个请求跟随 adapter 默认。
3. **刻意不走 `sessionController.selectModel`**：一句「用 X 建会话」不该顺手改掉用户的全局默认模型——那是用户在 GUI 里的显式动作才该有的效果。

路由发现单独给了一个只读工具 `session_models`：返回目录里全部 provider/model/显示名/思考档位/默认选择。起因是实测看到别的会话为「用 GLM-5.3 开会话」拿 `list_subagent_models`（子代理的模型面，受会话 provider 白名单限制）反复碰壁、最后去 grep DSH 配置文件——`session_create` 的 miss 报错虽然附完整目录，但只有先失败一次才知道这条路。`session_create` 的描述与 miss 报错尾部现在都指向 `session_models`。

## Alternatives considered

- **官方 `sessionController.selectModel`** —— 输在 `saveSelection` 副作用：工具按一句话改用户全局设置，越权且不可预期。
- **插件内做口语名模糊匹配（与 cwd 口语名解析对齐）** —— 模型 id 本就是短名（`glm-5.3`、`qwen-dsv4.1`），调用模型从用户话里直接解析 id 比插件再猜一层更短路径；目录随 provider 配置动态变化，插件内置匹配表反而要维护；歧义判定交给调用方，插件只在 miss 时给全目录兜底。
- **复用 `agentPreset`** —— 预设捆绑整套行为，粒度不对；还要求用户预先建好预设。
- **建完让用户在 GUI 手动切** —— 首条消息已经用默认模型跑掉了，违背用户意图且不可逆。

## Consequences

- 代价：参数收精确 id，用户口语由调用模型解析（错误路径带完整目录，一次重试可解）；防御路径上若创建后 `ctx.agents` 里没有该会话（实际不会发生——`sessionController.create` 底层就是 `agents.create`，必留 live Agent），选模型失败会让整次调用报错，留下一个不可见的零事件会话。
- 换来：新会话首回合即跑在目标模型上；全局默认模型不被任何工具触碰；目录校验在创建之前，模型不可用时零副作用。
