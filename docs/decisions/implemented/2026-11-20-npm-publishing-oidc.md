# DR: 通过 npm 分发，tag 触发 GitHub Actions + OIDC Trusted Publishing

Status: implemented

## Problem

插件此前的唯一安装方式是把自己的本地目录指给 Desktop 的「添加插件」，等于没有分发：用户拿不到版本号、无法升级、无法验证产物来源，贡献者也没有可复现的安装路径。仓库里没有 `LICENSE`、没有 `.gitignore`、没有发布脚本，`package.json` 还带着 `private: true`，任何 `npm publish` 都会失败。

## Decision

包名 `@laoyuehanni/dsh-session-tools`，首个发布版本 `0.1.0`。

仓库当前处于**私有开发阶段**：`package.json` 带 `"private": true`，让 `npm publish` 直接失败，`publish.yml` 即使在私有仓库里被 tag 触发也无法真的发出去。`private` 只阻断发布，`npm pack`、冒烟测试、`dsh plugin add` 的本地安装都不受影响。准备首次发布时（先转公开、再发布）移除该字段并 bump 版本。

发布走两条路径，二者产物一致：

- 手动先跑通：`npm publish --access public`，由 `prepublishOnly` 串起 `typecheck → build:all → test`，任一步失败即拒绝发布。
- 自动化：推送 `v*` 或纯数字 tag 触发 `.github/workflows/publish.yml`。工作流先校验 tag 与 `package.json` 版本严格相等，再用 `pnpm install --frozen-lockfile` 重装、升级 npm CLI 到 11.5.1+，最后 `npm publish --provenance --access public`；版本号含 `-` 时自动加 `--tag next`。
- 认证使用 npm Trusted Publishing（OIDC）：工作流声明 `id-token: write`，`NODE_AUTH_TOKEN` 显式置空，不存任何静态令牌。

`files` 白名单只收 `lib`、`locale`、`docs/DETAIL.md`、`cordis.patch.yml`、`icon.svg`、两份 README，实测产物 19 个文件、44.8 kB。`lib/` 不入库，由 `prepublishOnly` 现场构建。

## Alternatives considered

- **继续本地目录 / git 直装** —— 输在没有版本号、没有 provenance、升级只能靠手动替换目录；也谈不上「开源发版」。
- **用 Secrets 存 `NPM_TOKEN`** —— 输在一个长期有效、带发布权限的静态令牌必须被保管和轮换；OIDC 让 npm 在发布时按工作流身份换取短期凭证，令牌从未落地。
- **沿用 `actions/setup-node` 的 `registry-url`** —— 输在 setup-node 会写 `.npmrc` 并注入一个占位 `NODE_AUTH_TOKEN`，那个假令牌优先级高于 OIDC 认证，发布会直接 401；因此工作流刻意不配 `registry-url`。
- **只做 CI、不做本地发布** —— 输在首次配置（建仓库、配 trusted publisher）周期长，本地 `npm publish` 是更快的第一次反馈；两者保留，互相不阻塞。

## Consequences

- 代价：发版流程变重——打 tag 前必须先把 `package.json` 版本改到与 tag 一致，否则工作流直接失败；`prepublishOnly` 让每次发布都要完整跑一遍类型检查、决策校验、构建与测试，慢但安全；`pnpm-lock.yaml` 必须入库，`--frozen-lockfile` 才能在 CI 成立；私有阶段多一道工序，转公开时得记得移除 `private` 并 bump 版本。
- 换来：可审计的 provenance 记录、无需保管发布令牌、rc 与稳定版通过 dist-tag 天然分流、以及一条失败即阻断的发布闸门；私有阶段则保证任何一次手滑的 `npm publish` 或误推 tag 都不会把包和 `lib/client.js.map` 里的源码发出去。