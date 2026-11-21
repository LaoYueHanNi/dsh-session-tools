# DR: 插件详情页正文改为面向用户的会话交互说明

Status: implemented

## Problem

插件详情页会把 `docs/DETAIL.md` 整篇渲染在卡片下方，但这份正文是按「行为设计文档」写的：四条工具的参数清单、投递的两条实现路径（热会话收件箱 / 冷会话 `sessionController.prompt`）、选择面板 chip 的序列化原理、回报协议的正文模板、实现层限制。正文 60 余行，用户要读完参数表才能知道这个插件能帮自己做什么。

这些实现细节又与 [README](../../../README.md#delivery-model)、[实现要点](../../../README.md#implementation-notes) 和 `docs/decisions/` 高度重复，同一批事实需要在多处同步，容易漂移。用户在详情页真正需要的是「会话之间怎么说话、我该怎么跟模型讲」，不是 `mode: queue | steer` 的枚举。

## Decision

`docs/DETAIL.md` 只保留用户向的自然语言说明，按四块组织：可以怎么用（传话 / 派活、要回信、看会话、挪进新会话、`/` 菜单入口）、消息怎么走（单向投递、发完即结束、回信由对方主动发出、忙闲语义、名字歧义时先确认）、少数用户会碰到的边界、以及「不用记工具名」。

工具参数、投递实现路径、chip 序列化机制、回报协议模板从详情页移除，权威说明留在 README 与 `docs/decisions/`。locale 的 `meta.description` 同步改成自然语言，并保留「输入框敲 `/` 选『会话消息』」这个可触发的 UI 标签。文档分工固定为：`docs/DETAIL.md` = 插件页正文（用户向），README = 安装与技术说明，`docs/decisions/` = 设计与取舍。

## Alternatives considered

- **保留长文，只润色语气** —— 输在长度本身就是问题：用户滚到一半仍会撞上参数清单，而且这些内容与 README 重复，两处都要维护。
- **按 DSH 官方插件规范只留一张功能图，把用法全部塞进 `meta.description`** —— 输在 description 的展示空间有限，单向投递、回信协议、读取边界这些语义写不下；本插件目前也没有功能图，用户明确希望详情页仍保留可读的说明。
- **拆出 `DESIGN.md` 专门放行为设计，`DETAIL.md` 只做用户文案** —— 输在新增一份文件与一个维护点；README 的投递模型、实现要点与决策记录已经承载了设计信息，再拆一份只会让读者在三个地方找同一件事。

## Consequences

- 代价：详情页不再是一份完整的 API / 行为参考；想查具体参数、`queue` 与 `steer` 的区别、冷热投递路径的人，必须转到 README 或决策记录。英文详情页指向中文正文的问题由[客户端文案本地化](./2026-11-21-client-copy-localization.md)解决：英文正文落在 `DETAIL.md`，中文迁至 `DETAIL.zh.md`。
- 换来：插件页第一屏就能读到「它能做什么、怎么跟它说话」，用户不必先过一遍参数；实现细节的权威来源收敛到 README 与 `docs/decisions/`，详情页不再与它们重复同步。
