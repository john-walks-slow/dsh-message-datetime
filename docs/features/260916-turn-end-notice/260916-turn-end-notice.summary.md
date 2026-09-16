# 260916-turn-end-notice 总结

## 需求

在 dsh-message-datetime 中注入"上一个 round 的结束时间"。用户偏好：在上一轮真正结尾处注入时间戳（而非下一轮开头回溯计算）。

## 实现

- **注入点**：`agent/turn-stopping`（最后一个 `step/end` 之后、`turn/end` 之前）通过 `agent.session.append("user/message", notice, { surfaceOp: "append" })` 追加 `Turn ended: <时间戳>`；dsh-session invariant 对 `user/message` 无位置约束，replay 安全。
- **时区一致**：`ZoneMemory`（WeakMap 按 agent 对象）缓存该 agent 最新开场读数选定的时区，关闭读数复用；无缓存回退配置时区。派发器 `agentEvents` fused payload 保证两钩子的 agent 为同一引用。
- **安全**：abort 直接跳过；整体 try/catch 失败仅 warn（serial 监听器抛错会把 `turn/end` reason 污染为 error，绝对禁止）；无新增运行时依赖。
- **格式**：`Turn ended: Wed 2026-09-16 10:41:03 +08:00 (Asia/Shanghai)`，summary 去秒；label 参数化重构 `timestamp.ts`。

## 验证

- `npm run check` + `npm test`：28/28 通过（新增 8 用例：label、时区复用/回退/切换、abort 跳过、append/formatter 失败降级、apply 双监听共享缓存）
- reviewer 检视：条件准入，无阻塞（R1 文档同步、N1/N2 注释准确性、N4 测试补充、N6 文案均已落实；N5 重复计算为确定性纯函数，接受）
- 4176 隔离实例启动稳定、无插件加载错误后清理；线上 4175 未动

## 已知边界

- abort/error/空输入轮次无关闭读数（turn-stopping 不派发；`turn/end` 事件仍在 log）
- loop 极罕见 dispatch-then-withdraw 竞态可能产生无害重复关闭读数（代码头注释已说明）

## 状态

代码与文档就位，等待用户书面同意后重启线上 4175 生效；实机验证项见 `260916-turn-end-notice.validation.md`。
