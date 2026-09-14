# dsh-message-datetime AGENTS.md

## 目标

dsh 插件（DeepSeek Harness / cordis plugin）：每个对话 turn 的第一个 step 向模型上下文注入一条单行时间戳（星期/日期/时间/UTC 偏移/IANA 时区），让模型始终知道"现在几点"。每 turn 恰一条、append-only、replay 安全。

## 地图

- `src/index.ts` — 插件入口：`Config`（schemastery，仅 `timeZone` 回退项）、`apply`（校验配置、缓存 formatter、注册 `agent/pre-step` prepend 监听）、`preStepHandler`（决策门控 + 容错：compose 失败只 warn 不打断 step）、`composeReading`（纯函数，step===1 才产出消息）
- `src/timestamp.ts` — 纯函数格式化：`createTimestampFormatter(zone?)` → `{ zone, formatReading, formatSummary }`，Intl h23 + longOffset + weekday
- `src/request-zone.ts` — 纯函数时区选择：`selectRequestTimeZone(messages, fallback)`，浏览器 `clientTimeZone`（唯一且可解析才采用）→ 回退；无效值静默回退
- `test/` — node:test，固定 epoch + 显式时区的精确断言（DST 边界、h23 午夜、UTC 归一）
- `cordis.patch.yml` — bundle 注册（id: message-datetime）

## 开发与调试

```bash
npm install && npm run build   # tsc → dist/src
npm test                       # 20 用例（tsc 含 test + node --test）
```

- 机制参考实现：官方 `@deepseek-ai/dsh-time-context`（/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-time-context/lib/index.js）；本插件 = 同机制 + step===1 每 turn 一次 + notice form 单行
- 接入 profile：`/root/.dsh/profiles/web/package.json` 的 bundles + `link:` 依赖（已接线）；改完在 4176 端口隔离验证（见 /restart-dsh），线上重启需用户书面同意
- 验证记录：`docs/features/260915-dsh-message-datetime/`（plan / review / validation / summary）

## 规范

- 依赖纪律（link 包 ESM 解析坑）：所有运行时 `import` 的 `@deepseek-ai/*` 必须显式声明在 `dependencies` 并本地 `npm install`；纯类型导入放 devDependencies。版本对齐 dsh 主包锁定值
- 注入契约：消息必须是 `user/message` + `source: { kind: "plugin", plugin: "dsh-message-datetime", form: "notice", summary }`（summary 走 `boundContextSummary`）；绝不写 assistant/message、绝不碰 step 事件顺序
- "绝不打断 turn"是硬约束：presentation 失败一律降级（跳过注入 + warn），不抛出
