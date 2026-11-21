# Agent notes for this repository

- **非平凡变更必须带决策记录**：在同一个提交里新增或更新 `docs/decisions/` 下的记录，规范见 [`docs/decisions/README.md`](./docs/decisions/README.md)。非平凡 = 改变行为、架构、跨文件契约、工具链、测试策略、磁盘或线上格式；纯机械局部编辑豁免。先搜索同主题，更新已有记录优先于新建。提交前跑 `pnpm run check:decisions`。
- **禁止自动打版本**：除非用户明确要求，不要 bump `package.json` 的 `version`，不要执行 `npm publish` 或推送 `v*` tag。版本与发布由用户决定。
- **包已公开发布**：`0.1.0` 已发布至 npm，`package.json` 不带 `private: true`（该字段实际从未设置，此前本文与发版记录声称带此字段系记载失实，已于 2026-11-21 勘误）。若要恢复私有闸门（加回 `private: true`），须由用户明确指示；`private` 字段不影响 `npm pack`、测试与 `dsh plugin add` 的本地安装。
- **改动后必须跑完整验证链**：`pnpm run typecheck && pnpm run build:all && pnpm test`。三者全绿才算完成，构建产物 `lib/` 不入库。
- **`lib/` 是构建产物**，已在 `.gitignore` 中；它通过 `files` 白名单进入 npm tarball，由 `prepublishOnly` 现场构建。
- **包名变更需要三处同步**：`package.json` 的 `name`、`cordis.patch.yml` 里 `insert[].name`、以及已安装 profile 的 `package.json`（dependencies 键名与 `dsh.profile.bundles` 数组）。
- **客户端产物契约**：`lib/client.js` 必须由 `tsdown.config.ts` 的 banner/footer 包成 `window.__ModuleLoader__.load` 工厂，且 `id` 等于包名。改动 `src/client` 后必须重新 `pnpm run build:client`，浏览器侧还需刷新页面才生效。
- **行为契约**：投递是单向的。任何改动都不得引入"发起方读取或轮询目标会话"的路径；回报只能由接收方主动 `session_send` 发回。`session_read` 仅用于用户明确要求查看某会话。
- **文档分工**：`docs/DETAIL.md` 是插件详情页正文（面向用户），`docs/releases/` 是逐版本说明，`README.md` / `README.zh.md` 是仓库首页（双语，改动需同步两份）。