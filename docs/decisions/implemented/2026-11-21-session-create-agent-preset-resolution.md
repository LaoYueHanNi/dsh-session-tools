# DR: `session_create` 的 Agent 预设接受口语称呼，创建前按名册解析

Status: implemented

## Problem

`session_create` 的 `agentPreset` 只收精确 id。用户说「用那个写代码的预设」时，调用模型没有任何途径满足这句话：预设 id 是声明用的 slug（如 `coder`），用户嘴里的词是名册里的显示名（`name`，如「写代码助手」），两者在 DSH 的 preset registry（`agentPresets` 服务）里是两个不同字段。模型既不知道这台 Host 有什么预设，也不知道 id 长什么样，只能瞎猜——猜错时 `sessionController.create` 深处的 `presets.resolve` 抛出 `agent-preset/not-found`，错误里只有一串 id、没有显示名，模型无从对照用户的话修正。

还有一个静默坑：没配预设名册的 profile 上（`ctx.get('agentPresets')` 为 undefined），controller 的 `composeAgent` 直接忽略 `agentPreset` 参数——用户明确指定的预设被无声丢弃，会话按默认组合跑掉了。

第三层问题在宿主内置预设上：DSH 内置的 standard / ptc / minimal / cordis 四个预设，宿主声明刻意不写 `name`（`dsh-agent-preset-registry/display` 的 `isBuiltInPreset` 判定就依赖这一点），本地化文案放在 Web 客户端的 locale 字典里，Host 工具链读不到。于是这套按显示名工作的机制对最常见的一组预设反而失效：`session_presets` 列出的是四个裸 id，用户说「开个创造模式的会话」时名册里没有任何可对照的词。

## Decision

融合两个先例：发现走 [模型路由选择](2026-11-21-session-create-model-selection.md) 的清单工具模式，解析走 [cwd 口语名解析](2026-11-20-cwd-spoken-name-resolution.md) 的本地匹配模式。

1. **新增只读工具 `session_presets`**：返回 `agentPresets.list()` 全量名册（id / name / description / isDefault / broken），无名册时返回空清单。这是正向发现路径——`session_models` 的先例证明「只有先失败一次才知道这条路」是真实痛点，预设这边更甚：模型连 id 的形状都猜不到。
2. **`agentPreset` 在创建前解析**（与模型路由同一条 miss-costs-nothing 规则，模型校验之后、目录解析之前）：
   - 无名册却指定了预设 → 显式报错并提示省略 `agentPreset`，替代原先的静默丢弃。
   - 精确 id 命中 → 用；命中 `broken`（激活失败）预设 → 报错附失败原因。
   - 否则对**可用**（非 broken）预设做归一化匹配（复用 cwd 解析的 `nameKey`：小写、去空格/下划线/连字符）：name 或 id 归一化相等 → 唯一命中用，多命中报错列候选（`id (name)`）。
   - 再做归一化包含（口语键是 name/id 键的子串）→ 唯一命中用，多命中报错列候选。
   - 零命中 → 报错附全名册渲染（含默认标记与 broken 标记，上限 20 行）并指向 `session_presets`。
   - 口语匹配刻意跳过 broken 预设——匹配到只会死胡同；但精确 id 命中 broken 仍明确报 broken，用户指名道姓时给出真话。
3. 解析结果作为 `preset` 字段回显在工具输出里，让调用方确认口语名落到了哪个预设。
4. **内置预设显示名 fallback**：名册行 id 属于 DSH 四个内置预设（standard / ptc / minimal / cordis）且声明未写 `name` 时，用插件内置的显示文案表补全 name / description（中文主名 + 英文别名，文案逐字取自宿主 Web 客户端 locale 字典 `dsh-client-ui-agent-preset/src/client/locales.ts`）。补全发生在 `presetRoster()` 读出名册之后，名册输出、口语匹配、错误信息里的名册渲染因此统一生效；匹配键在 name / id 之外扩到别名（`nameKey` 归一化后精确与包含比对），「创造模式」与 "Creator mode" 都命中 cordis。判定条件与上游 `isBuiltInPreset` 对齐：声明自带 `name` 的行整体走声明文案、永不覆盖，上游将来给内置声明补了 `name` 后声明值自动优先、fallback 自动退位；声明的 `description` 同样优先于 fallback 文案。别名只参与匹配，不进工具输出。

工具描述与参数描述同步写明精确 id / 口语称呼两种给法与歧义行为。

## Alternatives considered

- **完全交给调用模型（照搬模型路由先例：只加清单工具 + miss 附全名册，插件不做匹配）** —— 输在最常见路径多一次往返：模型听到「写代码」时很可能把用户原话直接塞进 `agentPreset`，插件一层本地集合比较就能吸收，失败消息还能反向纠正。模型那边能全交给模型，是因为模型 id 本身就是短名（`glm-5.3`），用户话到 id 的映射模型擅长；预设这边 id 与用户语言完全脱节，条件不同。
- **照搬 cwd 先例：只做插件内匹配、不加清单工具** —— 输在正向发现：模型不知道有「审阅」预设时永远不会提它；miss 报错只在模型已经猜错一次之后才出现。两条先例各取一半是对的。
- **用 `presets.resolve()` 做精确校验、miss 后再 `list()` 做口语匹配** —— 输在两次 diagnostic 往返；`list()` 一次拿全量（含 name/broken，且已按 order 排序），本地完成精确 id 与口语两级更短。
- **无名册时保持 controller 现状的静默忽略** —— 输在用户明确指定却被无声丢弃，比报错更糟；报错后模型一次重试（省略参数）即可回到正确行为。
- **编辑距离模糊匹配** —— 沿用 cwd 先例的否决理由：多命中概率高、解释成本高；归一化精确加包含已覆盖「写代码」→「写代码助手」这类真实说法，歧义交给候选报错。

## Consequences

- 代价：口语名只匹配可用预设，「称呼恰好只对上 broken 预设」时得到零命中错误（全名册渲染带 broken 标记，模型可见原因并改口）；`agentPresets` 与其他 `ctx.get` 服务一样走本地结构接口（[零运行时依赖](2026-11-20-zero-runtime-dependencies.md)），宿主形状变化编译期不报警；带 `agentPreset` 的每次创建多一次名册读取（registry 内部有 diagnostic 审计，创建不是热路径）；内置 fallback 表是宿主 locale 文案的静态快照，上游改文案或增删内置预设需随插件版本跟进，且只覆盖中英两种称呼，其他语言的用户仍需说 id 或显示名。
- 换来：用户说「用那个写代码的预设」直接落到正确预设，模型不必先失败一次；内置四预设摆脱裸 id，名册输出可读，「创造模式」/"Creator mode" 一类口语称呼直接命中；指定无效预设零副作用失败、附完整名册一次重试可解；无名册部署不再静默丢预设；`session_presets` 补上正向发现。冒烟测试覆盖名册列出、无名册空清单、精确 id、显示名归一化命中、包含命中、歧义、零命中、broken 精确、broken 口语排除、无名册拒绝、未指定省略，以及内置 fallback 的名册补全、声明文案优先、中英文名命中、内置名部分命中、miss 渲染共十六条分支。
