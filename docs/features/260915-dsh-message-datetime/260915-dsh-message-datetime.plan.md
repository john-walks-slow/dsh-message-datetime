# dsh-message-datetime 插件开发计划

- 日期：2026-09-15
- 状态：已批准（delay-validation 自动批准，见同目录 validation.md 决策 #4）
- 仓库：`/root/projects/dsh-message-datetime`（新建，git init）

## 1. 背景与目标

### 用户需求

开发一个 dsh 插件 `dsh-message-datetime`：**每个对话 round 开始时，向模型上下文注入一条简短时间戳**，让模型始终知道"现在几点、今天几号"——支撑日期推理（yymmdd 文档路径、"今天/明天"语义、计划任务）而无需询问用户。

### 需求解读（决策 #2）

"round" 在 dsh 里有窄义（goal 自动续跑回合），但按用户语境（"每一 round 开始时"）与最大效用原则，解读为：**每一个 turn 的第一个 step**。一次注入同时覆盖：

- 用户发起的普通 turn
- goal 自动续跑 round（round 驱动器为独立 turn）
- subagent 会话的 turn（subagent 无浏览器上下文，恰恰最缺时间感知；对本会话这次的 yymmdd 路径命名即典型用例）

每 turn 恰好一条（`step === 1` 判定），turn 内后续 step 不重复注入。

### 与官方 `@deepseek-ai/dsh-time-context` 的差异（为何不用它）

| 维度 | dsh-time-context（官方） | dsh-message-datetime（本插件） |
|------|--------------------------|-------------------------------|
| 注入频率 | 每个 eligible step | **每 turn 一次**（step 1） |
| 单条体量 | 三行（时间 + 时区政策 + elapsed） | **单行时间戳** |
| 默认状态 | opt-in，默认禁用 | 装入 profile 即生效 |
| 定位 | 严格时区政策解释（Schedule 场景） | 轻量时钟感知（日常全场景） |

机制上完全继承官方参考实现（`agent/pre-step` + durable user message），仅注入策略与文本形态不同。npm 上 `dsh-message-datetime` 名称可用，插件市场无同类轻量插件。

## 2. 用户体验设计

### 用户视角（GUI）

每轮对话开始时，聊天流中出现一个**折叠的 context chip**（ContextInjectionRow，非用户气泡），形如：

> ▸ `Current time: Tue 2026-09-15 01:04 +08:00`

点击可展开查看完整模型可见文本。不占注意力、不与用户消息混淆，与 dsh-proactive 唤醒提示同款呈现形态。

### 模型视角

turn 内最后一个 user message 之后、请求发出之前，追加一条单行消息：

```
Current time: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai)
```

包含：星期、日期、时分秒、UTC 偏移、IANA 时区名。约 30 token/turn，append-only 不破坏 KV cache（新内容跟在可复用前缀之后）。

### 用户路径

1. **零配置可用**：装入 profile → 重启 → 每个 turn 自动出现时间戳 chip。时区自动取浏览器上报时区（user-rpc 消息的 `clientTimeZone`），无浏览器来源时回退到 Node 进程时区（本机 Asia/Shanghai）。
2. **可选配置**：`timeZone`（回退显示时区，schemastery 声明，GUI 插件设置面板自动渲染表单）。
3. **验证路径**：任意会话发一条消息 → 立即看到 chip；问模型"现在几点" → 直接答对。

## 3. 架构设计

### 注入机制（继承 dsh-time-context 已验证模式）

```
ctx.on("agent/pre-step", async (payload, next) => {
  const decision = await next();          // 先让下游决策（prepend: true 排最前）
  if (decision.kind !== "enter") return decision;   // reject 不注入
  if (payload.signal.aborted) return decision;      // 已中止不注入
  if (payload.step !== 1) return decision;          // 每 turn 仅 step 1
  const text = composeReading(payload, config, Date.now());
  return { ...decision, messages: [...decision.messages, createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "plugin", plugin: "dsh-message-datetime",
              form: "notice", summary: shortSummary },
  })]};
}, { prepend: true })
```

要点（全部来自平台调研结论）：

- **`agent/pre-step` 是唯一**既能接触本 turn 已认领 user 消息、又在 `request/header` 之前注入的扩展点；`decision.messages` 由 dsh-agent-loop 统一 `session.append("user/message", ...)` 落盘（dsh-agent-loop/lib/index.js:559）。
- **token-meter replay 安全**：注入天然落在 `step/start..step/end` 窗口内；user/message 无窗口约束（仅 assistant/message 需要）。不触碰 assistant/message 与 step 事件顺序。
- **source attribution**：`kind: "plugin"` 使 GUI 渲染为 context chip 而非用户气泡；`form: "notice"` + `summary` → 折叠 chip 显示一行摘要（dsh-proactive 同款）。
- **无临时注入通道**：LLM 请求消息唯一来源是 durable surface（`session.deriveMessages()`），故必须落盘为 durable user message。system-prompt section 方案被否决：每 step 重渲染会变更请求头部、**击穿整个前缀 KV cache**，官方 README 明确 append-only 才是 cache 友好。

### 时区解析链

```
本 turn user-rpc 消息的唯一 clientTimeZone（canonical IANA 校验）
  → config.timeZone（Intl 校验）
    → Node 进程时区
```

mixed/缺失浏览器时区直接回退，不做 time-context 式的"向用户澄清"政策（本插件定位是时钟，不是时区裁决）。subagent turn 无 rpc 来源，自然落到回退链。

### Replay 完整性（无 invariant companion，见 validation.md 决策 #5）

web profile 不挂载 `invariants` 服务（仅 sdk-minimal 挂载，官方 web 场景插件同样无 companion 运行），故不做 invariant companion。replay 安全由以下保证：

- 结构性安全：注入是 step 窗口内的 `user/message`（token-meter 对其无窗口约束），不触碰 assistant/message 与 step 事件顺序。
- 单测断言消息的精确形状（单 text block、source form/summary、追加位置）。
- E2E 用例覆盖会话重载/回放。

### 依赖与版本纪律（dev-dsh-plugin 核心坑）

所有 `import` 的 `@deepseek-ai/*` 包必须显式写进 `dependencies` 并本地 `npm install`（版本对齐主包锁定，实施时用 `node -e "require('.../package.json').version"` 核对），杜绝 link 包 ESM 解析失败拖垮整棵 plugin tree。

## 4. 实现方案

### 目录结构（TypeScript + tsc，dsh-proactive 同款）

```
/root/projects/dsh-message-datetime/
├── package.json            # name/type:module/main:./lib/index.js/exports 含 ./cordis.patch.yml
│                           # dsh.bundle.patch: ./cordis.patch.yml；dependencies 显式声明
├── cordis.patch.yml        # - insert: [{ id: message-datetime, name: dsh-message-datetime }]
├── tsconfig.json / tsconfig.build.json
├── src/
│   ├── index.ts            # Config(schemastery) + apply：pre-step 监听、注入
│   ├── timestamp.ts        # 纯函数：formatReading / formatSummary（Intl，含星期/偏移/IANA）
│   └── request-zone.ts     # 纯函数：从本 turn user 消息 source 提取/校验 clientTimeZone
├── test/                   # node:test（dsh-clear-mind/dsh-proactive 同款）
│   ├── timestamp.test.ts
│   ├── request-zone.test.ts
│   └── injection.test.ts   # 模拟 pre-step 调用：step===1 才注入、reject/abort 跳过、消息形状
├── README.md
├── AGENTS.md               # 项目级说明（/update-project-instruction）
├── .gitignore
└── docs/features/260915-dsh-message-datetime/   # 本计划 + validation（已建）
```

### 配置 schema

```ts
export const Config = z.object({
  timeZone: z.string().description("回退显示时区（IANA），默认取进程时区"),
});
```

刻意保持最小配置面：格式、频率不开放配置（每 turn 一条、单行是产品定位本身）。

### 关键实现细节

- `createUserMessage` from `@deepseek-ai/dsh-llm`；`inject = ["agents", "invariants"]`（以后端实际服务名为准，实施时对照 dsh-time-context 的 inject 数组与 invariant 注册方式）。
- 时间格式化用 `Intl.DateTimeFormat`（en-US，h23，longOffset），星期缩写单独映射；拒绝亚秒精度（对齐官方 whole-second 决策）。
- GUI summary 与模型文本同源生成（summary 去秒），保证 chip 与正文一致。
- 准备失败重试可能留下已注入读数（与官方行为一致，已知可接受）。

## 5. 测试与验收

### 单元测试（node:test）

1. 时间戳格式化：固定 Date 在多个时区（Asia/Shanghai、UTC、America/New_York 夏令时边界）的输出快照；偏移/星期/零填充正确。
2. 时区解析：无 rpc 来源/单一 canonical/非 canonical 拒绝/mixed → 各自回退路径。
3. 注入决策：step 1 注入、step≥2 不注入、reject/aborted 不注入、消息恰一个 text block、source 形状、追加在 messages 末尾。

### 端到端验证（隔离实例，重启线上前）

按 `/restart-dsh` 技能流程在单独端口起隔离实例（加载含本插件的 profile），子代理执行：

1. 发送一条用户消息 → GUI 出现 `Current time: ...` 折叠 chip。
2. 问模型"现在几点、今天星期几" → 回答与注入时间戳一致。
3. 检查会话 JSONL：事件为 `user/message`、source attribution 正确、落在 `step/start..step/end` 内。
4. 多步 turn（触发工具调用）→ 仅 step 1 一条注入。
5. 重载/回放该会话 → token-meter replay 无异常、invariant 通过。

### 验收标准

- 单测全绿；隔离实例 E2E 全过；`sv status dsh` 线上实例全程未受影响。

## 6. 交付与安装

1. 构建产物 `lib/` 齐全，`npm install` 后 `require.resolve` 验证依赖可解析。
2. 接入 profile：`/root/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 追加 `dsh-message-datetime`，`dependencies` 加 `"dsh-message-datetime": "link:/root/projects/dsh-message-datetime"`，profile 目录安装依赖。
3. **stopBefore restart**：以上全部完成后停下，向用户呈交决策摘要与 E2E 证据，请求书面同意后按 `/restart-dsh` 重启线上实例。

## 7. 风险与对策

| 风险 | 对策 |
|------|------|
| link 包依赖未声明 → plugin tree 崩溃循环 | dependencies 显式声明 + 本地安装 + require.resolve 验证 + 隔离实例先行 |
| 注入破坏 replay | user/message 天然安全 + invariant 护栏 + E2E replay 用例 |
| 与 dsh-time-context 同时启用 → 双重时间注入 | 本插件 README 注明互斥建议；不做代码级互斥（官方包默认禁用） |
| KV cache 效率 | append-only 注入，官方已验证模式 |
| 时区回退不符用户预期 | 回退链顺序：浏览器 → config → 进程；配置可在 GUI 修改 |

## 8. 明确不做（v1 边界）

- 不做 elapsed time / 时区政策文本（官方包领地）
- 不做 refreshIntervalMs 节流（每 turn 一条已是最低频率）
- 不做客户端 UI 定制（notice chip 已满足呈现）
- 不发布 npm（本地 link 使用；名称已确认可用，留待日后）
