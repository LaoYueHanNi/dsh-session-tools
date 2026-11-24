# DR: 升级插件矢量图标（icon.svg）并补充顶层 icon 元数据

Status: implemented

## Problem

本插件此前的 [icon.svg](../../../icon.svg) 存在三处与 DSH 插件管理页规范不一致的问题：

1. 使用 `viewBox="0 0 24 24"` 且未声明 `width="36" height="36"`，主体几乎贴边，在插件管理页与其他 36×36 官方图标并排时光学尺寸明显偏大；
2. 前景气泡使用 `#1F2937` 深色纯填充，在深色主题卡片底板上对比度过低；
3. [package.json](../../../package.json) 仅在 `exports` 和 `files` 中列出了 `icon.svg`，未在顶层声明 `"icon": "./icon.svg"`，导致宿主按顶层 `icon` 字段查找时无法直接命中。

## Decision

1. **重绘 36×36 自包含矢量图标**（[icon.svg](../../../icon.svg)）：
   - 遵循 DSH 插件图标规范：采用 `width="36" height="36" viewBox="0 0 36 36"`，光学内容居中留白，不绘制背景瓷砖，不使用 `<script>`、`<style>`、`<text>`、`<image>`、`foreignObject` 或事件属性；
   - 延续「双会话气泡」主题，左上源会话气泡使用蓝紫渐变（`#7AC2FF → #4A65E8`）与简洁文本线，右下目标会话气泡使用青绿渐变（`#4AE5AC → #098E9A`）叠加纯白向右交接箭头，直观表达跨会话消息传递与交接能力，并在明暗主题下均保持清晰对比度。
2. **补充顶层 `icon` 元数据**（[package.json](../../../package.json)）：
   - 在顶层声明 `"icon": "./icon.svg"`，与既有 `files` 和 `exports` 中的 `icon.svg` 保持一致。
3. **契约测试守护**（[tests/plugin-icon.mjs](../../../tests/plugin-icon.mjs)）：
   - 校验 `package.json` 的 `icon`、`files` 声明以及 `icon.svg` 的体积上限、36×36 视口与自包含几何约束，并接入 `pnpm test`。

## Alternatives considered

- **仅在旧 24×24 图标上把 `#1F2937` 改亮**：仍存在光学边界偏大、缺少明确交接方向语义以及风格与 DSH 官方渐变图标不协调的问题。
- **使用单气泡加外置箭头**：相比双气泡错落叠放，跨会话（源会话 → 目标会话）的语义表达较弱，也容易与官方 `session-titles-bundle` 的单气泡图标混淆。

## Consequences

- 在 DSH 插件管理页中，本插件的图标在尺寸、配色、明暗主题可读性与语义辨识度上均与官方插件对齐。
- `pnpm test` 增加了一项零依赖的图标与元数据检查，防止后续误删或破坏自包含 SVG 约束。
