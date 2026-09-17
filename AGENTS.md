# dsh-message-datetime AGENTS.md

## 目标

dsh 插件（DeepSeek Harness / cordis plugin）：每个对话 turn 的第一个 step 向模型上下文注入一条单行开场时间戳（星期/日期/时间/UTC 偏移/IANA 时区），turn 正常收尾时再注入一条单行关闭读数（`Turn ended: ...`），让模型始终知道"现在几点、上一轮何时结束"。每 turn 恰两条（中断轮无关闭读数）、append-only、replay 安全。

## 地图

- `src/index.ts` — 插件入口：`Config`（schemastery，仅 `timeZone` 回退项）、`apply`（校验配置、缓存 formatter、注册 `agent/pre-step` prepend 监听 + `agent/turn-stopping` serial 监听，二者共享 `ZoneMemory` WeakMap 时区缓存）、`preStepHandler`（决策门控 + 容错：compose 失败只 warn 不打断 step；成功产出读数后缓存该轮选定时区）、`turnStoppingHandler`（abort 直接返回；经 `agent.session.append("user/message", …, { surfaceOp: "append" })` 写入关闭读数；整体 try/catch 绝不抛出——serial 派发抛错会把 `turn/end` reason 污染为 error）、`composeReading`（纯函数，step===1 才产出消息）
- `src/timestamp.ts` — 纯函数格式化：`createTimestampFormatter(zone?)` → `{ zone, formatReading, formatSummary, formatEndedReading, formatEndedSummary }`，Intl h23 + longOffset + weekday，label 参数化（Current time / Turn ended）
- `src/request-zone.ts` — 纯函数时区选择：`selectRequestTimeZone(messages, fallback)`，浏览器 `clientTimeZone`（唯一且可解析才采用）→ 回退；无效值静默回退
- `test/` — node:test，固定 epoch + 显式时区的精确断言（DST 边界、h23 午夜、UTC 归一、关闭读数时区复用/回退/降级）
- `cordis.patch.yml` — bundle 注册（id: message-datetime）

## 开发与调试

```bash
npm install && npm run build   # tsc → dist/src
npm test                       # 28 用例（tsc 含 test + node --test）
```

- 机制参考实现：官方 `@deepseek-ai/dsh-time-context`（/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-time-context/lib/index.js）；本插件 = 同机制 + step===1 每 turn 一次 + notice form 单行 + turn-stopping 轮间关闭读数
- 关闭读数的平台依据：dsh-session invariant 对 `user/message` 无位置约束（`case 'user/message': break`），`agent/turn-stopping` 在最后一个 `step/end` 之后、`turn/end` 之前派发，且派发器 `agentEvents` 的 fused payload 保证 pre-step 与 turn-stopping 的 `agent` 是同一对象引用（WeakMap 缓存键成立）
- 接入 profile：`/root/.dsh/profiles/web/package.json` 的 bundles + `link:` 依赖（已接线）；改完在 4176 端口隔离验证（见 /restart-dsh），线上重启需用户书面同意
- 验证记录：`docs/features/260915-dsh-message-datetime/`（首版）、`docs/features/260916-turn-end-notice/`（关闭读数）

## 发布

- v0.1.0 已双渠道发布：npm `dsh-message-datetime` + GitHub `john-walks-slow/dsh-message-datetime`（topics: dsh-plugin / deepseek-harness / ai-agent，市场自动收录触发器已就位；npm 包 `repository` 字段回指仓库）
- 发新版流程：bump version → `npm test` → `npm pack --pack-destination /tmp` → `node ~/.agents/skills/npm-publish/scripts/publish-webauthn.cjs /tmp/<tgz>` → 把打印的 AUTH_URL 交给用户指纹确认（约 5 分钟窗口）→ push GitHub
- npm 账号 johnnren 已绑 passkey（npm 已下线 TOTP）；bypass-2FA token 直发 2027-01 移除，勿走 token 路线
- awesome-dsh-plugin PR：仓库满 1 天（2026-09-18 起）后提 `data/plugins/john-walks-slow__dsh-message-datetime.yml`，description 属实不夸大（会被对着代码核）

## 规范

- 依赖纪律（link 包 ESM 解析坑）：所有运行时 `import` 的 `@deepseek-ai/*` 必须显式声明在 `dependencies` 并本地 `npm install`；纯类型导入放 devDependencies。版本对齐 dsh 主包锁定值
- 注入契约：消息必须是 `user/message` + `source: { kind: "plugin", plugin: "dsh-message-datetime", form: "notice", summary }`（summary 走 `boundContextSummary`）；绝不写 assistant/message、绝不碰 step 事件顺序
- "绝不打断 turn"是硬约束：presentation 失败一律降级（跳过注入 + warn），不抛出——对 turn-stopping 尤其致命（抛错会改写本轮 `turn/end` reason）
