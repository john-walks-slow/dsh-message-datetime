# dsh-message-datetime 交付总结

- 日期：2026-09-15
- 状态：开发、检视、隔离实例 E2E 全部完成；待用户同意后重启线上 dsh 生效

## 交付内容

全新 dsh 插件 `/root/projects/dsh-message-datetime`：每个对话 turn 的第一个 step 注入一条单行时间戳（`Current time: Tue 2026-09-15 01:31:48 +08:00 (Asia/Hong_Kong)` 式），plugin-attributed notice（GUI 折叠 chip），模型由此始终知道当前时间。约 30 token/turn，append-only 不破坏 KV cache。

- `src/index.ts` — `agent/pre-step`（prepend）监听：先 `next()`，enter 且未 abort 且 `step===1` 时把 `composeReading` 产出的 notice 追加到 `decision.messages` 末位；compose 失败降级为 warn，绝不打断 step
- `src/timestamp.ts` — Intl（h23 + longOffset + weekday）单行格式化，reading（含秒）/ summary（去秒）同源
- `src/request-zone.ts` — 时区链：turn 内唯一浏览器 `clientTimeZone` → config `timeZone` → 进程时区；无效/混合静默回退
- 20 个 node:test 用例全绿（DST 边界、h23 午夜、UTC 归一、alias canonical 化、门控矩阵、容错、apply 注册与 fail-fast）

## 关键决策（详见 plan.md 与 validation.md 决策记录）

1. "round" 解读为每个 turn 的 step 1（覆盖用户 turn / goal round / subagent turn）
2. 机制完全继承官方 `dsh-time-context`（已验证模式），差异仅在注入策略：每 turn 一次、单行、notice form
3. 砍掉 invariant companion：web profile 未挂载 `invariants` 服务，companion 在目标环境永不激活
4. system-prompt 方案否决（每 step 重渲染击穿前缀 KV cache）；durable append-only 是平台钦定路径

## E2E 证据（隔离实例 4176，生产 4175 全程未动）

- 实例加载插件零错误，端口/进程稳定
- 真实对话：模型 reasoning 原文引用注入的时间戳并正确作答（01:31、星期二）
- 多步 turn（bash 工具调用）：step 1 注入一条，step 2 无注入（JSONL seq 221 vs 279）
- 事件形状：`user/message` + `source{kind:plugin, plugin:dsh-message-datetime, form:notice, summary}`，落在 step/start 与 request/header 之间
- 浏览器时区优先级生效：camoufox 上报 Asia/Hong_Kong 正确覆盖进程回退 Asia/Shanghai
- 页面重载（replay）：会话渲染正常，"2 轮 · 3 步"统计正确，chip 各就各位

## 检视

reviewer 结论：**条件准入**，无阻塞问题。已落实：AGENTS.md（R1）、LICENSE 持有人、handler 级容错 + 3 个新测试锁定（compose 失败降级、apply prepend 注册、apply fail-fast）、配置描述中文化。

## 遗留

- 线上重启（需用户书面同意，stopBefore 停止点）
- E2E 测试会话 `session-960971b7`（/root/.dsh/sessions/--root-projects--/）留在了会话列表，可删可留
- npm 发布未做（名称可用，留待日后）
