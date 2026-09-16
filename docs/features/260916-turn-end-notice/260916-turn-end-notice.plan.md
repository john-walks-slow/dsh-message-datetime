# 260916-turn-end-notice 计划

## 背景

dsh-message-datetime 首版（260915）在每个 turn 的 step 1 注入单行 `Current time: ...`。用户希望进一步注入"上一个 round 的结束时间"，并明确偏好：**在上一轮真正结尾处注入该时间戳**（而非下一轮开头回溯计算）。

## 平台依据（已对照 dsh 源码核实）

- `agent/turn-stopping` 钩子：serial 派发，时机在最后一个 `step/end` 之后、`turn/end` 之前，payload 含 `agent`（agentEvents fused，与 pre-step 同一对象引用）
- dsh-session invariant 对 `user/message` 无位置约束（`case 'user/message': break`），轮间追加合法；assistant/message 才受 step 窗口约束
- agent-loop 既有同型写入：`session.append("user/message", message, { surfaceOp: "append" })`
- serial 监听器抛错会把本轮 `turn/end` reason 污染为 error → 监听器必须绝不抛出

## 方案（用户已确认的决策点）

1. **注入点**：`agent/turn-stopping` 监听，轮次正常收尾时追加 `Turn ended: <时间戳>`（只显示时间戳，无 elapsed）
2. **时区一致性**：pre-step 成功产出开场读数后按 agent 对象（WeakMap）缓存该轮选定时区；turn-stopping 复用，无缓存回退配置时区
3. **GUI summary**：开场读数 summary 不变；关闭读数 summary `Turn ended: <去秒时间>`
4. **安全**：abort 直接返回；整体 try/catch，失败仅 warn 降级；无新增运行时依赖
5. **已知边界**：abort/error/空输入路径不派发 turn-stopping，中断轮无关闭读数（`turn/end` 事件仍在 log 记录原因）；loop 极罕见的 dispatch-then-withdraw 竞态可能产生无害的重复关闭读数

## 交付物

- `src/timestamp.ts`：`formatEndedReading/formatEndedSummary`（label 参数化重构）
- `src/index.ts`：`ZoneMemory/NoticeSession/NoticeAgent`、`readingNotice`、`turnStoppingHandler`、`preStepHandler` 时区缓存、`apply` 双监听
- 测试 28 用例（新增 8：label 断言、时区复用/回退/切换、abort 跳过、append/formatter 失败降级、apply 双监听共享缓存）
- 验证：`npm run check` + `npm test` 全绿 → 4176 隔离实例启动稳定（无 plugin 加载错误）→ 线上 4175 重启需用户书面同意
