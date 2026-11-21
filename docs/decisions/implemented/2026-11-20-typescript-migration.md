# DR: 源码迁移到 TypeScript，node 半与 client 半分别由 tsc 和 tsdown 构建

Status: implemented

## Problem

插件此前是两份手写 JavaScript：根目录 `index.js`（756 行，注册四个工具）与 `client.js`（409 行，手写 `window.__ModuleLoader__.load` 工厂）。两者都没有类型检查，改动一处无法确认影响了哪些调用面；工具参数只能靠运行时 `typeof` 判断收敛；跨会话投递与浏览器服务面都退化成字符串比较。对外也没有 `.d.ts`，宿主或其它插件无法类型化消费；仓库没有任何构建链路，发布前唯一的验证是一次手写冒烟脚本。

## Decision

源码放在 `src/`：`src/index.ts` 是 Host 半，`src/client/index.ts` 是 Client 半。`tsc -p tsconfig.json` 把 Host 半编译到 `lib/` 并产出 `index.d.ts`；`tsdown` 只负责把 Client 半打成 `lib/client.js`（外加 tsc 仍会产出 `lib/client/index.js` 与它的 `.d.ts`，后者是 `exports["./client"].types` 指向的文件）。类型统一锁定到当前运行时的 `0.2.2-rc.5`，`@deepseek-ai/cordis` 锁 `^4.x`。

`tsconfig.json` 打开 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noUnusedLocals`、`noUnusedParameters`，因此所有可选字段的赋值都写成条件展开（`...(x === undefined ? {} : { x })`）而不是传 `undefined`。

Client 半继续用 `React.createElement`（局部 `h` 别名）而不是 JSX，`src/client/index.ts` 后缀也保持 `.ts`。

## Alternatives considered

- **保持纯 JavaScript，加 JSDoc + `tsc --checkJs`** —— 输在拿不到 `.d.ts`；工具 `parameters` / `output.schema` 与平台服务的类型仍停留在注释层面，`exactOptionalPropertyTypes` 这类真正能挡住空洞赋值的约束也用不上。
- **Client 半改写为 `.tsx` + JSX** —— 输在需要额外确认 tsdown 的 JSX 运行时配置（`react/jsx-runtime` 的 external 与 automatic runtime 的交互），而该文件的原始写法就是 `createElement`，逐行迁移的风险最小、可读性收益有限。
- **改用 `defineTool` + 参数 schema DSL 注册工具** —— 输在要再引入一套 schema 构造器并重写四份参数声明；原始问题只是「`args` 是 `unknown`」，用局部入参接口在 `execute` 开头收窄即可解决，迁移风险远小于收益。
- **只保留 tsc，Client 半也用 tsc 输出** —— 输在 tsc 不会生成 `window.__ModuleLoader__.load` 的 banner/footer 包装，也没有把平台模块标记为 external 的能力，产物无法被 web shell 接受。

## Consequences

- 代价：多了一层构建——改完源码必须 `pnpm run build:all` 才能跑冒烟测试（测试针对 `lib/` 产物而非源码）；`lib/client/index.js` 是 tsc 的冗余产物，只为了它的 `.d.ts` 而存在；tsdown 每次构建都会提示建议使用 ESM 格式，而 loader 契约要求 CJS factory，只能保留该提示。
- 换来：工具注册、投递路径、标题解析与浏览器服务面全部进入类型检查；对外产出 `index.d.ts`；`prepublishOnly` 里 typecheck 失败即阻断发布；类型版本与运行时版本显式对齐，升级 DSH 时版本漂移会变成一次可见的编译错误而不是线上行为差异。