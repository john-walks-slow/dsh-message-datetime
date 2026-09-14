# 检视报告

- 对象：dsh-message-datetime（全新 dsh 插件，每 turn 第一个 step 注入单行时间戳 notice）
- 日期：2026-09-15
- 检视人：reviewer 子代理
- 对照基准：设计计划（同目录 plan.md）、官方参考实现 `@deepseek-ai/dsh-time-context`、平台契约源码（dsh-agent / dsh-llm / dsh-token-meter / dsh-api-session-controller / dsh-util-time / dsh-client-ui-chat）

## 概要

检视范围为该仓库全部新增代码（src 3 文件、test 3 文件、工程配置与文档），并独立复核了上下文给出的全部平台事实。整体评价：实现质量高——机制完全继承官方已验证的 `agent/pre-step` waterfall 模式，纯函数拆分清晰、依赖注入（Clock）使测试确定性好，所有关键平台契约经源码核实一致，未发现阻塞问题。

## 需求对齐

核心需求全部落实，与计划的关键设计决策一致：

- **每 turn 恰好一条**：`step === 1` 判定（src/index.ts:47）；reject 决策与 aborted 信号透传不注入（src/index.ts:71-73）；消息追加在 `decision.messages` 末位（src/index.ts:74）——与计划 §3 机制图逐行对应，与官方参考实现的 waterfall 用法（dsh-time-context/lib/index.js:215-247）同构，含 `prepend: true` 与先 `await next()` 的顺序。
- **单行时间戳**：星期/日期/时分秒/UTC 偏移/IANA 时区齐备（src/timestamp.ts:41）；`GMT`→`GMT+00:00` 归一（src/timestamp.ts:39）与官方 `formatTimestamp` 同款处理；`h23` 避免午夜 24 点。
- **notice form + summary**：`form: "notice"` + `summary`（src/index.ts:52-57）满足 ContextFormed 约束（form `'notice'` 必带 `summary: string`，dsh-llm/lib/types/message.d.ts:82-84）；summary 经 `boundContextSummary` 封顶 120 字符（message.d.ts:110-116）；与 dsh-proactive 的 notice 组合惯例（framing.ts:80-91）一致；GUI 折叠 chip 呈现由 dsh-client-ui-chat ContextBody 的 notice 语义证实（"summary is the collapsed row's one-line account"，ContextBody.d.ts:69-115）。
- **时区解析链**（浏览器唯一 → config → 进程）：按计划 §3 实现。且比官方参考更防御——官方 `browserTimeZone` 对无效/非 canonical 值直接抛 `TypeError`（dsh-time-context/lib/index.js:14,21），本插件静默回退（src/request-zone.ts:31-36），该差异是计划已记录的明确决策（本插件定位时钟而非时区裁决）。
- **平台事实独立复核**（非仅采信上下文声明）：
  - `PreStepDecision` 形状与 `agent/pre-step` payload 签名逐字段一致（dsh-agent/lib/types/runtime-types.d.ts:50-57、239-245）；
  - token-meter 仅对 `assistant/message` 施加 step 窗口约束（dsh-token-meter/lib/index.js:725-727），`user/message` 无窗口约束——注入天然 replay 安全；
  - Host 确实经 `canonicalClientTimeZone` 规范化 `clientTimeZone` 后才写入 user-rpc 消息 source（dsh-api-session-controller/lib/index.js:732-744；dsh-util-time/lib/index.js:19-29），request-zone.ts 头注释表述准确，插件内的再 canonical 化是冗余但无害的防御层；
  - web profile 确未挂载 `invariants` 服务（dsh-base/dsh-web-app 无引用、profile node_modules 无该包），"不做 invariant companion" 的实施期决策成立（validation.md 决策 #5）；
  - profile 当前未启用 dsh-time-context，README 的互斥建议暂无现实冲突。
- **依赖纪律**（dev-dsh-plugin 核心坑）：三个运行时依赖精确锁定且与 dsh 主包逐一核对一致（cordis 4.0.2 / dsh-llm 0.1.2-rc.1 / schemastery 3.18.2）；cordis 与 dsh-agent 为纯类型导入，已核实 `dist/src/index.js` 运行时仅引用 dsh-llm 与 schemastery——dsh-agent 放 devDependencies 正确且安全；本地 node_modules 已安装，profile link 已建立。
- **偏差**（均为良性或流程性）：
  1. 计划 §4 交付清单明确列出的 AGENTS.md 未交付（见 R1）；
  2. `formatSummary` 含 IANA 时区后缀，比计划 §2 的 chip 草图（无时区）略长——但计划 §4 "summary 与模型文本同源生成（去秒）" 的实现指令被准确执行，57–76 字符远低于 120 上限，信息量更足，可接受；
  3. 计划 §4 草图写 `main:./lib/index.js`，实际为 `./dist/src/index.js`——与所引 dsh-clear-mind 模板逐字段一致（package.json/tsconfig/scripts/patch yml 全同），属草图不精确，非实质偏差。
- **流程状态**：validation.md 的 E2E 验证项全部"待验证"；profile 已接线（bundles + link 依赖 + node_modules 符号链接，2026-09-15 01:29），但线上 dsh 进程启动于 2026-09-14 23:13（早于接线），stopBefore restart 纪律未被违反，线上实例未受影响。E2E 与重启属交付门禁，不在本次代码准入范围内，准入后须按计划 §6 完成。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| R1 | 仓库根（缺失文件） | 计划 §4 交付清单（plan.md:127）明确列入的项目级 AGENTS.md 未交付，Changes 清单亦未提及；后续会话/子代理进入该仓库将缺少构建测试命令与 link 安装纪律的入口说明 | 按 /update-project-instruction 规范补齐：构建/测试命令、`@deepseek-ai/*` 依赖显式声明纪律（dev-dsh-plugin 核心坑）、注入机制一句话说明、与 dsh-time-context 互斥提示 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | LICENSE:3 | 版权行仅 "Copyright (c) 2026" 无持有人；同模板 dsh-clear-mind 写作 "dsh-clear-mind contributors" | 补为 "Copyright (c) 2026 dsh-message-datetime contributors" |
| N2 | src/index.ts:82-101 | `apply()` 无直接测试：invalid config 的 fail-fast 抛错文案、`ctx.on("agent/pre-step", …, { prepend: true })` 注册行为未在测试中锁定；且 `preStepHandler` 的内联 payload 类型（src/index.ts:67）与平台事件签名的一致性目前靠人工维持 | 补一条小用例：mock `ctx.on` 捕获 listener 与 options 断言 prepend；断言 `apply(ctx, { timeZone: "Mars/X" })` 抛含插件名前缀的错误 |
| N3 | src/index.ts:48,92-98 | README:21 "无效值静默回退，绝不打断 turn" 的承诺目前靠 `selectRequestTimeZone` 前置 Intl 校验的结构性保证（到达 `formatterFor` 的 zone 必然已通过一次相同 Intl 构造校验），是一个非局部不变量——今日无现实抛错路径，但未来重构 `selectRequestTimeZone` 时该保证可能静默失效 | 在 `composeReading` 取 formatter 处加一层 try/catch 回退 fallback formatter，使 no-throw 契约局部化 |
| N4 | src/index.ts:31-33 | Config 字段 description 为英文，GUI 插件设置面板会原样渲染给中文用户 | 视需要改为中文或中英并列（生态内官方插件多为英文描述，保持现状亦可） |
| N5 | test/injection.test.ts | 未覆盖 `decision.messages` 为空数组的 step 1 注入路径（goal 自动续跑/无 inbox 消息的 turn 形态）；该形态的时区回退已在 request-zone 单测覆盖（空数组用例），仅 handler 层缺一条 | 可与 N2 合并补一条空消息注入用例（断言仍注入且用 fallback 时区） |

另记录：本次检视按"只检视、不测试"原则未重新执行测试套件，"17 个用例全绿"采信自交付声明；已通过阅读核实 dist 产物与 src 一致、测试断言自洽（固定 epoch、显式时区、决策对象恒等断言，跨时区宿主环境确定性良好；DST fall-back、h23 午夜、UTC 归一等边界均有精确断言）。

## 准入结论

**结论**：`条件准入`

**说明**：无阻塞问题，代码与平台契约逐项核实一致、测试设计有效、依赖纪律完备；存在 1 项建议修改（AGENTS.md 补齐，R1）与 5 项非阻塞备忘，建议合并前或后续迭代处理。交付侧仍须按 validation.md 完成 E2E 验证并取得用户书面同意后，方可按 /restart-dsh 流程重启线上实例（计划 §6 stopBefore 门禁）。
