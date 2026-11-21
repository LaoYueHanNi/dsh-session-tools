# DR: 插件零运行时依赖，依赖全部为 import type

Status: implemented

## Problem

Host 半使用的平台能力（`ctx.tools`、`ctx.sessionController`、`ctx.sessionQuery`、`ctx.sessions`、`ctx.agents`、`ctx.workspaceRegistry`、`ctx.sessionProjections`、`ctx.sessionTitle`）都来自宿主，插件不应该、也不能自己带一份。但 TypeScript 需要这些声明才能检查代码，于是很容易顺手把它们写成 `peerDependencies`，让安装方看到一个「本包需要 cordis」的声明。

在 pnpm 的 `link:` 安装下，`peerDependencies` 会直接产生警告：*The linked in dependency will not resolve the peer dependencies from the target node_modules*。而该 peer 在运行时**从未被 require**——所有引用都是 `import type`，编译后不留任何 import 语句。

## Decision

`package.json` 里没有 `dependencies`、`peerDependencies`、`optionalDependencies` 三节中的任何一项。所有平台包只出现在 `devDependencies`，且源码里一律写成 `import type {} from '…'`（纯声明合并）或 `import type { X } from '…'`（取类型）。Client 半只保留一处运行时 import：`import React from 'react'`，它由 web shell 的冻结模块表通过 loader 注入的 `require` 解析，`tsdown.config.ts` 的 `PLATFORM_MODULES` 里明确列出。Host 半不 import 任何平台包；它使用的 Node 内置模块（目前只有 `node:fs/promises` 的 `stat`，见 [cwd 口语名解析](../implemented/2026-11-20-cwd-spoken-name-resolution.md)）不参与依赖解析，不改变本决策。

需要平台对象时（`workspaceRegistry`、`sessionProjections`、`sessionProjectionCache`、`sessionTitle`）一律走 `ctx.get(name)` 并在插件侧声明最小结构接口，避免为拿类型而引入运行时代码。

## Alternatives considered

- **把 `@deepseek-ai/cordis` 声明为 peerDependency** —— 输在安装时必然报警告，且警告指向的问题不存在（运行时不需要它）；`legacy-peer-deps` 之类的绕法只是把噪声藏起来。
- **把平台包声明为 `dependencies`** —— 输得更彻底：等于要求每个用户额外装一份与宿主版本可能不一致的 cordis，既浪费又可能造成双实例。
- **完全不用平台类型，全部手写 `any`** —— 输在放弃 DR [源码迁移到 TypeScript](../implemented/2026-11-20-typescript-migration.md) 的全部收益；结构化最小接口已经能在不引运行时依赖的前提下拿到足够的检查强度。

## Consequences

- 代价：类型完备性依赖 `devDependencies` 的版本锁定，无法借用宿主 `node_modules` 里的类型；升级 DSH 时必须手动对齐这一组版本（写死在 `package.json`）；对 `ctx.get(name)` 的返回需要自己声明接口，宿主改了形状后编译期不会报错，只能靠冒烟测试和行为验证兜住。
- 换来：安装零依赖解析、零 peer 警告；npm tarball 只包含自己的代码；client bundle 里除自身代码外只剩平台模块的 external 引用，不会与宿主的 React / Cordis 版本冲突。