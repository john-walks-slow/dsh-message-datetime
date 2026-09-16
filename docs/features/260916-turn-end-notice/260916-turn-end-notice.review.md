# 检视报告

- 对象：dsh-message-datetime turn-end notice 功能——`agent/turn-stopping` 边界追加关闭读数 `Turn ended: <时间戳>`，时区复用本轮 step-1 读数选定值（WeakMap 按 agent 缓存），无缓存回退配置时区
- 日期：2026-09-16
- 检视人：reviewer 子代理
- 对照基准：与用户对齐的需求计划（上下文转述）、官方参考实现 `@deepseek-ai/dsh-time-context`、平台契约源码（dsh-agent-loop / dsh-agent / dsh-session / dsh-token-meter / cordis）
- 范围：工作区未提交改动（src/index.ts、src/timestamp.ts、test/injection.test.ts、test/timestamp.test.ts 修改 + test/turn-end.test.ts 新增）

## 概要

检视范围为上述全部改动，并独立复核了上下文给出的全部平台契约（非仅采信声明）。整体评价：实现质量高，可以准入。核心设计判断全部正确——关闭读数选用 `user/message`（而非 `assistant/message`）恰好落在合法位置；监听器全量 try/catch 满足 serial 派发"绝不抛出"的硬约束；经 `agentEvents` fused payload 共享同一 agent 对象使 WeakMap 时区缓存方案成立。26/26 测试通过（含新增 6 条），dist 产物已同步重建，无新增运行时依赖。

## 平台契约独立复核（逐项源码核实）

- **user/message 位置无约束**：session invariant `case "user/message": break;`（dsh-session/lib/invariant.js:81）——turn 之间、step 窗口外追加均合法；对照组 `assistant/message` 要求开放 step（同文件 :56）。关闭读数选型正确。
- **token-meter replay**：仅对 `assistant/message` 施加 step 窗口校验（dsh-token-meter/lib/index.js:727），对 `user/message` 无任何位置检查（全文件无该事件类型分支）——关闭读数 replay 安全。
- **派发时机与边界**：`agent/turn-stopping` 在最后一个 `step/end`（finally，dsh-agent-loop/lib/index.js:563）之后、`turn/end`（外层 finally，:597）之前派发（:570），与头注释声称的边界逐字一致。
- **serial 无 next、抛错污染 turn/end**：`dispatch.serial` 顺序 await 各 listener、无 next（cordis/lib/index.js:289-294）；派发点位于 `turn()` 的 try 内，listener 抛错会落入 catch 将 `turnEnds` 置为 error 并写入 `turn/end` reason（dsh-agent-loop/lib/index.js:574-590）。本监听器除 `payload.signal.aborted` 一处读取外全部在 try/catch 内（src/index.ts:126-133），append 失败、formatter 抛错、agent 形状异常均降级为 onError，实际不可达抛出路径（见 N3 的理论性备忘）。
- **fused payload 保证 agent 同引用**：`agentEvents` 以 `{ ...payload, agent }` 注入 subject（dsh-agent/lib/index.js:344-345），loop driver 在构造时一次性建立 dispatcher 并复用（dsh-agent-loop/lib/index.js:360）——pre-step waterfall 与 turn-stopping serial 的 `agent` 为同一对象引用，WeakMap 键共享成立；子代理各自独立 driver 实例，互不串扰。
- **surfaceOp 合规**：`user/message` 属 surface-eligible 事件，缺 surfaceOp 会被 session 拒绝（dsh-session/lib/index.js:164）；实现提供 `{ surfaceOp: "append" }`，与 agent-loop 自身写 decision 消息的既有用法同构。测试对 options 做了精确断言（test/turn-end.test.ts:52）。
- **Session.append 签名**：运行时 `append(type, data, opts)`（dsh-session/lib/index.js:1403）与 `NoticeSession` 结构化类型匹配，无需引入 dsh-session 依赖——依赖纪律维持原状（无新增 dependencies）。

## 需求对齐

- **时区复用**：pre-step 成功产出读数后缓存 `selectRequestTimeZone(decision.messages, fallbackZone)`（src/index.ts:105），turn-stopping 优先取缓存、无缓存回退配置时区（src/index.ts:128）。缓存仅在 step===1、非 abort、enter 决策、compose 成功时写入——语义正确；本轮 compose 失败时沿用上一轮缓存区时区，与上下文中最近一条开口读数的显示时区一致，是合理的连贯性退化。
- **abort 跳过**：`signal.aborted` 早退（src/index.ts:126），测试覆盖（turn-end.test.ts:74-81）。实际派发点之前 loop 已 `throwIfAborted`，该分支属防御性冗余，无害。
- **降级不抛出**：整体 try/catch + onError（ctx.logger.warn），turn 以自身 reason 关闭；测试覆盖 append 抛错路径（turn-end.test.ts:83-89）。
- **label 重构**："Current time:"/"Turn ended:" 常量参数化（src/timestamp.ts:9-12），时间戳形状（星期/日期/秒/longOffset/IANA）与开口读数完全一致，精确断言锁定（timestamp.test.ts:15-20、turn-end.test.ts:58-61）。
- **apply 双监听**：共享同一 zones 与 onError（src/index.ts:160-165），turn-stopping 不加 prepend（顺序无意义）正确；apply 级共享验证到位（turn-end.test.ts:91-115，用真实 clock 正则锁定形状 + New York 偏移证明 zone memory 打通）。
- **测试增量**：injection.test.ts 注册数 1→2、payload 补 `agent` 字段与生产 fused payload 一致；未破坏原有 20 用例。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| R1 | README.md、AGENTS.md（仓库根与模块说明） | 文档仍描述"每 turn 恰好一条/每 turn 第一个 step 注入单行时间戳"（README「模型看到什么」「行为规则」首条；AGENTS.md 目标/地图），与本功能交付后的每 turn 两条读数（开口 + 关闭）及新增 `agent/turn-stopping` 监听不符；上轮检视 R1（补 AGENTS.md）同类问题复发 | 按 /update-project-instruction 与 /update-module-instruction 规范更新：目标补一句关闭读数；地图补 turnStoppingHandler/ZoneMemory；README 行为规则改为"每 turn 两条：开口 Current time + 关闭 Turn ended"，并补充 abort/error/blocked 轮次无关闭读数的边界说明 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | src/index.ts 头注释、test/turn-end.test.ts | turn-stopping 存在"派发后撤回"竞态：loop 派发后重新检查 `inbox.nextStep.length`（dsh-agent-loop/lib/index.js:570-575），若消息恰在派发 await 窗口内到达，turn 会继续执行后续 step，同轮将收到第二条关闭读数，第一条成为轮中出现的历史行。概率极低（微秒级窗口）、replay 安全、真实结束时的读数仍正确，且插件侧拿不到 inbox 无法规避 | 在头注释已知边界处补一句说明即可；无需代码改动 |
| N2 | src/index.ts:20-21 | 头注释称"Aborted or failed turns never reach agent/turn-stopping"，实际无关闭读数的路径还包括：pre-step reject（blocked 直接 return false，dsh-agent-loop turn() 内不派发）与 `turnEnds && decision.messages.length === 0` 的 break 路径（max-tokens 后 inbox 有 pending 消息、下轮 decision 为空时 break） | 注释改为"aborted、failed、blocked 及无后续消息的提前收束轮次不派发 turn-stopping"，保持文档与 loop 行为逐字对齐 |
| N3 | src/index.ts:126 | `payload.signal.aborted` 读取在 try 之外，是监听器中唯一理论可抛出点（仅当未来 payload 变更缺 signal 时会以 TypeError 污染 turn/end reason）；今日 loop 恒传 signal，实际不可达 | 将早退判断移入 try 内（或去掉该判断——派发点前 loop 已保证未 abort），使"绝不抛出"成为无局部依赖的结构性保证 |
| N4 | test/turn-end.test.ts | 覆盖缺口三处：(1) 关闭读数的 compose 失败路径（formatterFor 抛错→onError 降级）未测，现有 append 抛错用例未覆盖 catch 的另一分支；(2) "latest" 语义仅单轮验证，缺跨轮时区切换（turn 1 NY → turn 2 Shanghai → 关闭读数用 Shanghai）用例；(3) 测试 clock 固定，无法证明关闭读数取的是 end 时刻而非开口时刻 | 各补一条小用例；clock 可注入递增序列以区分两次 now() 采样 |
| N5 | src/index.ts:82,105,130 | 两处轻微冗余/绕折：(1) `readingNotice` 以双闭包传 formatter 方法再传入 now，调用点 `readingNotice((at) => formatter.formatEndedReading(at), ...)` 绕折明显，改为 `readingNotice(formatter, kind, now)` 更直读；(2) preStepHandler 中 `selectRequestTimeZone` 在 composeReading 内部与缓存写入处各算一次（纯函数、同输入，结果恒一致，仅重复计算） | 纯风格优化，可顺手做；让 composeReading 返回 `{ reading, zone }` 可同时消除两处 |
| N6 | src/index.ts:162 | onError 文案 "skipped a reading after a compose failure" 对 turn-stopping 的 append 失败场景词不达意 | 改为 "skipped a reading after a failure" 或按事件区分文案 |

## 流程与部署状态

- 本次检视实际执行了 `npm test`（tsc 全量编译 + node --test）：26 用例全绿（原 20 + 新增 6），并单独复跑 test/turn-end.test.js 5/5 通过；已核实 dist/src 与 src 同步（含 turn-stopping 注册与 TURN_ENDED_LABEL）。
- 线上实例加载的是旧 dist；功能生效需按 /restart-dsh 流程在隔离端口验证后重启，且须取得用户书面同意——属交付门禁，不在本次代码准入范围内。
- 提交前建议使用 /commit-own-changes（工作区含 4 个修改 + 1 个未跟踪新文件，需一并纳入）。

## 准入结论

**结论**：`条件准入`

**说明**：无阻塞问题。代码与平台契约逐项源码核实一致，"绝不打断 turn"硬约束（监听器不抛出、降级 warn）落实到位，时区复用方案经 fused payload 同引用事实支撑成立。条件为 R1（README/AGENTS.md 文档同步）；N1–N6 建议合并前或后续迭代处理。准入后仍须完成 E2E 验证并取得用户书面同意方可重启线上实例。
