# DR: 按宿主表面事件读取消息文本

Status: implemented

## Problem

宿主用户消息直接存放于事件 data，而助手消息位于 data.message。统一按后者读取会漏掉用户正文。

## Decision

`session_read` 仅投影用户和助手事件中的文本块，兼容宿主两种事件数据形状；继续限制返回条数及单条长度。发送和创建路径不读取目标内容。

回归测试通过实际发布的 `SessionStore` 和 `SessionQueryEngine` 构造并读取双角色事件，覆盖角色筛选、非正文过滤和最近消息截取。

## Alternatives considered

- **统一按嵌套 message 读取** —— 与宿主用户事件形状不符，会漏读。

## Consequences

- 代价：读取结果仍是有限长度的模型面文本，不包含非文本内容。
- 换来：用户和助手的可见文字都能进入结果。
