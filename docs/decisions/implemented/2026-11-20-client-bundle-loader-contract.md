# DR: client 半由 tsdown 的 banner/footer 生成 loader 工厂，注册 id 取包名

Status: implemented

## Problem

DSH 动态 Client bundle 必须是 `window.__ModuleLoader__.load({ id, factory })` 形态的闭包工厂，且 `id` 必须等于安装包名——web shell 会拒绝注册 id 与 loader 条目包名不一致的 bundle。此前的 `client.js` 把这个结构连同包名一起**手写**在文件开头，同时手工维护一份 `require('react')` 的平台模块清单。包名一改（例如加 npm scope），文件里的 `id` 就会静默漂移；平台模块清单也没有任何机制保证与 shell 的冻结模块表一致。

## Decision

`src/client/index.ts` 写成普通 ES module（`import React from 'react'`、只导出 `name` / `inject` / `apply`），由 `tsdown.config.ts` 负责变形：

- `banner` 打开 `window.__ModuleLoader__.load({ id: <package.json name>, factory: (require) => {`，`footer` 补 `return module.exports; } });`，`intro` 提供 `module` / `exports` 两个局部绑定。注册 id 通过 `createRequire(import.meta.url)('./package.json').name` 读取，与包名单一来源。
- `PLATFORM_MODULES` 列出的模块（`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-ui-slots`、`-ui-primitives`、`-ui-attachment`、`@deepseek-ai/dsh-client-schema-form`）走 `neverBundle`，由 loader 注入的 `require` 从冻结模块表解析；其余一律 `alwaysBundle` 内联。
- 输出固定为 `lib/client.js`（`entryFileNames` 钉死），`clean: false`，避免默认清理把 tsc 产出的 node 半一起删掉。

## Alternatives considered

- **继续手写 IIFE 包装** —— 输在包名硬编码、与实际安装名漂移时没有任何编译期或运行期提示，只表现为「插件不加载」，排查成本极高；也无法使用 `import` 语法，只能靠 `require` 字符串。
- **用环境变量或构建参数传 id** —— 输在多一个必须记得传的变量；从 `package.json` 读取没有这个失败模式。
- **让 `alwaysBundle` 兜底全部依赖（不声明 external）** —— 输在 React 会被打进 bundle，与 shell 已有的 React 形成两份实例，hooks 与 context 直接失效。
- **引入 lightningcss 的 CSS Modules 插件（照抄参照实现）** —— 输在本插件没有任何 `.module.css`，这份配置只会增加构建面与依赖；需要时再补。

## Consequences

- 代价：产物必须是 CJS 格式，因此 tsdown 每次构建都会给出「建议使用 ESM」的提示，只能保留；改完 `src/client` 必须重新 `pnpm run build:client` 并刷新浏览器页面才生效，没有热更新；`PLATFORM_MODULES` 是照抄宿主清单的手工镜像，宿主调整模块表时需要同步。
- 换来：注册 id 与包名永远一致；平台模块不重复打包，bundle 只有自身代码（15.05 kB / gzip 5.78 kB）；`import` 语法与类型检查可用，`src/client` 与 `src/index.ts` 共享同一套 `tsconfig`。