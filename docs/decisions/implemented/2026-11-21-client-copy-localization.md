# DR: 客户端文案与详情页跟随界面语言

Status: implemented

## Problem

Client 半的可见文案全部是硬编码中文：`/` 菜单行名「会话消息」、命令描述、搜索框占位与空态、会话列表的「未命名会话」与「刚刚」、投递来源徽标「收到消息，来自」、composer 失败通知前缀，以及 chip 提交时序列化出的 `[目标会话：<标题>]` 标记。英文界面的用户在一份全是英文的菜单里看到一行中文，行名无法对应 README 与 `meta.description` 里的说明。

配套问题：`locale/en.json` 与 `locale/zh.json` 的 `meta.detail` 都指向中文的 `docs/DETAIL.md`，英文用户的插件详情页整页中文；英文 README 里的操作说明也直接引用中文行名。

## Decision

浏览器侧的可见文案全部改走宿主的 Client locale 服务（`@deepseek-ai/dsh-client-locale` 提供，dshmarket 同款用法）：`apply` 里以 `ctx.inject(['locale'])` 注册本包词条（命名空间 `session-tools-client`，en/zh 双词典），并把模块级翻译函数 `t(key, arg?)` 重绑到 `ctx.locale.bind`；服务缺席的宿主回落英文词典。`dsh.client.inject` 增加 `@deepseek-ai/dsh-client-locale`。

词条覆盖九个键：行名、命令描述、搜索三态、未命名标题、目标标记模板、徽标前缀、通知前缀、刚刚。命令的 `label` / `description` / `searchLabels` 本就是函数形式，每次求值都取当前语言，语言切换无需重新挂载。

给模型读的两段文本同步对齐：chip 序列化标记按界面语言产出 `[目标会话：…]` 或 `[Target session: …]`，`session_send` 工具描述改为两种写法都点名；Host 侧其余协议常量（回信信封）保持中文不动——那是投递协议的一部分，模型可读，与界面语言无关。

文档侧：`docs/DETAIL.md` 改为英文正文（`locale/en.json` 指向它），中文正文迁至 `docs/DETAIL.zh.md`（`locale/zh.json` 指向），`files` 白名单同步；`meta.description` 英文版改用英文行名 Session message；英文 README 的行名、标记、徽标全部英文化并注明中文界面对应文案，中文 README 只补一句英文行名注记。README 里过时的「四个工具」一并改为五个。

## Alternatives considered

- **只把行名做成英文，其余文案不动** —— 输在半中半英比全中文更刺眼：搜索框、徽标、通知仍会在英文界面里漏中文。
- **不走 locale 服务，用 `navigator.language` 自行判断** —— 输在用户的语言偏好存在 Host 设置里（可显式选择），浏览器语言只是缺省来源；绕开服务会与宿主其余 UI 的语言不一致。
- **把词条放进 `locale/*.json` 与 `meta` 同文件** —— 输在该文件的消费方是 Host 侧插件管理器（只读 `meta.*`），Client 侧词典经 `ctx.locale.register` 注册，两者生命周期与打包路径都不同，混放会让一份文件服务两个互不相识的读取方。

## Consequences

- 代价：词条新增一个维护点，中英文案需同步增改；`t` 是模块级可变绑定，依赖注册时机，测试只能覆盖 fallback 路径；浏览器侧的实际渲染效果（英文界面下的行名与详情页）本会话无浏览器控制，未做可视化验证。
- 换来：英文用户看到全英文的菜单行、详情页与 README；标记、徽标、通知随界面语言产出；旧宿主（无 locale 服务）自动回落英文而不是加载失败。
