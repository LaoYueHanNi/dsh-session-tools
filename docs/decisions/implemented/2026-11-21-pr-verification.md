# DR: PR 持续验证项目检查

Status: implemented

## Problem

仅在发布时运行构建和测试会使普通 PR 的回归不能及时暴露。

## Decision

PR 和 main 推送运行冻结依赖安装、类型检查、决策校验、完整构建及测试。

包清单的 `engines.dsh` 声明当前验证使用的 `0.2.2-rc.5`。回归使用同版本的发布包，后续扩大兼容范围需补对应版本的验证。

## Alternatives considered

- **仅依靠发布工作流** —— 回归直到发布时才会被自动检查发现。

## Consequences

- 代价：每次 PR 消耗 CI 构建资源。
- 换来：常规检查失败会直接反映在 PR 状态中。
