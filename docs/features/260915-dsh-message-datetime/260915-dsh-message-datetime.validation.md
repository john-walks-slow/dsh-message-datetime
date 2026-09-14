# dsh-message-datetime 延迟验证记录

## 验证说明

- 验证对象：dsh-message-datetime 插件——每个对话 round（turn）开始时向模型上下文注入一条简短时间戳 user message
- 环境/前置条件：本机 dsh（/usr/lib/node_modules/@deepseek-ai/dsh，GUI http://127.0.0.1:4175）；插件以 link: 方式接入 /root/.dsh/profiles/web；单端口隔离实例验证后才会请求重启线上实例

## 延迟决策记录

| # | 环节 | 原本需要确认的问题 | 采取的决定 | 依据/理由 | 状态 |
|---|------|--------------------|-----------|----------|------|
| 1 | stopBefore 解释 | `/delay-validation stopBefore restart` 中 "restart" 指哪个阶段 | 映射为「重启线上 dsh 实例之前」（/restart-dsh 流程的最后一步）：此前全部自动推进（计划批准、实施、单端口 E2E 验证、commit），进入重启线上实例第一步前停下询问真实用户 | "restart" 在本任务语境中最自然的所指即重启 dsh 使插件生效；且重启线上实例本就属于高风险项（影响正在运行的会话，含本会话） | 待确认 |
| 2 | 需求解读 | "每一 round 开始时"中 round 的含义 | 解读为每个 turn 的第一个 step：覆盖用户 turn、goal 自动续跑 round、subagent turn；每 turn 恰一条 | dsh 中 goal round 本身即独立 turn；subagent 无浏览器时间感知、恰是最需要时钟的场景；"round" 日常语义即对话轮次 | 待确认 |
| 3 | 设计选型 | 注入形态：notice chip vs 官方 snapshot 形态；每 turn vs 每 step；时区来源 | 单行时间戳 + form:"notice" 折叠 chip；step===1 每 turn 一次；时区链：浏览器 clientTimeZone → config → 进程时区；含 invariant replay 护栏 | 官方 dsh-time-context 是 per-step 三行重注入（默认禁用），与本需求"每 round 简短"定位不同；notice 形态已被 dsh-proactive 验证；机制（agent/pre-step + durable user message）完全继承官方参考实现 | 待确认 |
| 4 | 计划批准 | 是否按 260915-dsh-message-datetime.plan.md 开始实施 | 批准实施 | 计划基于双路代码调研（平台机制 + 本地工程实践），机制全部来自已验证的官方参考实现，无可预见的阻塞；改动全部在新目录，可回退 | 待确认 |
| 5 | 实施期设计修订 | 计划中的 invariant replay 护栏是否实施 | 砍掉 invariant companion：web profile 未挂载 `invariants` 服务（dsh-base/dsh-web-app 的 cordis.patch.yml 均无 invariant 行，仅 sdk-minimal 挂载；profile node_modules 无 dsh-invariants），companion 在目标环境永不激活；官方 time-context 在 web 场景同样无 companion 运行 | replay 安全性由结构保证（user/message 落在 step 窗口内，平台约束）+ 单测断言消息形状 + E2E 回放用例覆盖；避免引入死代码 | 待确认 |
| 6 | 检视处置 | reviewer 条件准入（1 建议 + 5 非阻塞）如何处置 | 全部落实：AGENTS.md 补齐（R1）、LICENSE 持有人、handler 级容错降级 + 3 个新测试锁定、配置描述中文化；良性偏差（summary 含时区）确认为改进保留 | 无阻塞问题；容错改动符合"绝不打断 turn"硬约束；单测 20/20 绿 | 待确认 |

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| -------- | -------- | -------- | ------ | --------- |
| 隔离实例中发送一条用户消息 | GUI 出现 `Current time: ...` 折叠 chip（非用户气泡），展开为单行时间戳文本 | 通过：DOM 中 `XrJvXW_summary` span 精确渲染一次 `Current time: Tue 2026-09-15 01:31 +08:00 (Asia/Hong_Kong)` | 通过 | session-960971b7 JSONL seq 11 |
| 隔离实例中问模型"现在几点、今天星期几" | 回答与注入的时间戳一致 | 通过：模型答"2026年9月15日 凌晨 01:31，星期二"，reasoning 原文引用注入时间戳 | 通过 | 同上 |
| 触发一次带工具调用的多步 turn | 仅 step 1 注入一条，后续 step 无重复 | 通过：turn 2 两步，seq 221（step 1）注入，step 2（seq 279 前后）无注入 | 通过 | 同上 |
| 检查会话 JSONL 注入事件 | `user/message`、source={kind:plugin, plugin:dsh-message-datetime, form:notice}、落在 step/start..step/end 内 | 通过：seq 11/221 均落在 step/start 之后、request/header 之前，source 形状精确匹配 | 通过 | 同上 |
| 重载/回放该会话 | token-meter replay 无异常，统计正确 | 通过：重载后"2 轮 · 3 步"统计正确渲染，无任何报错 | 通过 | 隔离实例日志 0 error |
| 线上重启后在真实会话使用（需用户同意重启） | 每 turn 出现时间戳 chip，模型日期推理正确 | | 待验证 | stopBefore 停止点：待用户同意重启线上 dsh |

补充证据：浏览器时区优先级链生效（camoufox 上报 Asia/Hong_Kong 正确覆盖进程回退 Asia/Shanghai）；隔离实例与线上 4175 并存期间线上 RUNNING 无影响；单测 20/20 绿；reviewer 条件准入问题全部落实。

## 验证结论

隔离实例 E2E 五项全部通过（证据见验证项表）；线上重启后验证为最后一项，等待用户同意重启。

## 待跟进

- 用户同意后按 /restart-dsh 重启线上 dsh（setsid 延迟重启方式），重启后完成最后一项验证
- E2E 测试会话 session-960971b7 留在会话列表，可删可留
