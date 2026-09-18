# dsh-message-datetime AGENTS.md

## 目标

dsh 插件（DeepSeek Harness / cordis plugin）：每个对话 turn 的第一个 step 向模型上下文注入一条单行时间戳（含星期/日期/时间/UTC 偏移/IANA 时区，以及上一轮结束时间和闲置时长），让模型始终知道"现在几点、上一轮何时结束、空闲了多久"。每 turn 仅一条（在 step===1 开场时注入）、append-only、replay 安全，且完全保护 DSH Web UI 的原生分支（fork）功能不被尾部节点破坏。

## 地图

- `src/index.ts` — 插件入口：`Config`（schemastery，仅 `timeZone` 回退项）、`apply`（校验配置、缓存 formatter、注册 `agent/pre-step` prepend 监听）、`preStepHandler`（决策门控 + 容错：compose 失败只 warn 不打断 step；读取 session 最后一个 `turn/end` 产出开场读数）、`composeReading`（纯函数，step===1 才产出消息）、`findLastTurnEnd`（安全从 session 获取上轮结束时间）
- `src/timestamp.ts` — 纯函数格式化：`createTimestampFormatter(zone?)` → `{ zone, formatReading, formatSummary, formatEndedReading, formatEndedSummary }`，`formatIdleDuration` 计算友好空闲间隔
- `src/request-zone.ts` — 纯函数时区选择：`selectRequestTimeZone(messages, fallback)`，浏览器 `clientTimeZone`（唯一且可解析才采用）→ 回退；无效值静默回退
- `test/` — node:test，固定 epoch + 显式时区的精确断言（DST 边界、h23 午夜、UTC 归一、空闲间隔换算、合并读数断言）
- `cordis.patch.yml` — bundle 注册（id: message-datetime）

## 开发与调试

```bash
npm install && npm run build   # tsc → dist/src
npm test                       # 25 用例（tsc 含 test + node --test）
```

- 机制参考实现：官方 `@deepseek-ai/dsh-time-context`（/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-time-context/lib/index.js）；本插件 = 同机制 + step===1 每 turn 一次 + notice form 单行 + 跨轮空闲自动换算
- 分支保护原则：不在 `agent/turn-stopping` 向 session 追加任何 `user/message`。DSH Web UI 要求 `turn-tail` 必须是该轮最后一个可见节点才能触发 fork；在下一轮 `pre-step` 统一消费上一轮的 `turn/end` 事件时间戳。
- 接入 profile：`/root/.dsh/profiles/web/package.json` 的 bundles + `link:` 依赖（已接线）

## 发布

- v0.1.0 已双渠道发布：npm `dsh-message-datetime` + GitHub `john-walks-slow/dsh-message-datetime`（topics: dsh-plugin / deepseek-harness / ai-agent，市场自动收录触发器已就位；npm 包 `repository` 字段回指仓库）
- 发新版流程：bump version → `npm test` → `npm pack --pack-destination /tmp` → `node ~/.agents/skills/npm-publish/scripts/publish-webauthn.cjs /tmp/<tgz>` → 把打印的 AUTH_URL 交给用户指纹确认（约 5 分钟窗口）→ push GitHub
- npm 账号 johnnren 已绑 passkey（npm 已下线 TOTP）；bypass-2FA token 直发 2027-01 移除，勿走 token 路线
- awesome-dsh-plugin PR：仓库满 1 天（2026-09-18 起）后提 `data/plugins/john-walks-slow__dsh-message-datetime.yml`，description 属实不夸大（会被对着代码核）

## 规范

- 依赖纪律（link 包 ESM 解析坑）：所有运行时 `import` 的 `@deepseek-ai/*` 必须显式声明在 `dependencies` 并本地 `npm install`；纯类型导入放 devDependencies。版本对齐 dsh 主包锁定值
- 注入契约：消息必须是 `user/message` + `source: { kind: "plugin", plugin: "dsh-message-datetime", form: "notice", summary }`（summary 走 `boundContextSummary`）；绝不写 assistant/message、绝不碰 step 事件顺序
- "绝不打断 turn"是硬约束：presentation 失败一律降级（跳过注入 + warn），不抛出——对 turn-stopping 尤其致命（抛错会改写本轮 `turn/end` reason）
