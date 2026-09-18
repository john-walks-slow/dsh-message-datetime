# dsh-message-datetime

<p align="center">
  <a href="./README.md"><strong>简体中文</strong></a> ·
  <a href="./README.en.md"><strong>English</strong></a>
</p>

每个对话 turn 开始时，向模型上下文注入**简短时间戳与跨轮空闲间隔**的 dsh 插件（DeepSeek Harness / cordis plugin）。

模型由此始终知道"现在几点、今天星期几、上一轮何时结束、闲置了多久"——日期运算、"今天/明天"语义、跨轮空闲间隔感知、yymmdd 路径命名等不再需要询问用户或猜测。

## 模型看到什么

每个 turn 的第一个 step，在用户消息之后追加一条单行通知（约 30~50 token，append-only 不破坏 KV cache）：

**首轮（无上一轮记录）：**
```
Current time: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai)
```

**后续轮次（自动合并上一轮结束时间与闲置时长）：**
```
Current time: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai) | Last turn ended: Tue 2026-09-15 00:39:34 +08:00 (idle for 25m)
```

通知在 GUI 中渲染为折叠的 context chip（非用户气泡），折叠行显示去掉秒的摘要与闲置时间（例如 `Current time: Tue 2026-09-15 01:04 +08:00 (idle 25m)`），点击展开完整文本。

## 行为规则与设计理念

- **每 turn 恰一条（开场注入）**：仅 `step === 1` 注入；turn 内后续 step（工具调用续步）不重复。
- **保护 DSH 原生分支（Fork）**：不在 turn 收尾时向会话末尾追加独立节点，避免破坏 Web UI 中 `turn-tail`（操作栏）的“最后一条消息”约束，确保每轮的分支功能畅通无阻。
- **开箱即用的跨轮感知**：无需模型自己翻阅历史计算耗时，下一轮自动从会话日志解析上一个 `turn/end` 时间戳，并直接计算友好的空闲间隔（如 `<1m`、`25m`、`1h 10m`、`2d 5h`）。
- **覆盖所有会话**：用户 turn、goal 自动续跑 round、subagent turn 均注入（subagent 无浏览器上下文，最需要时钟）。
- **时区解析链**：本 turn 浏览器上报时区（`clientTimeZone`，唯一时才采用）→ 配置的 `timeZone` 回退 → Node 进程时区。无效值静默回退，绝不打断 turn。
- **replay 安全**：读数为 `user/message`（plugin-attributed notice），位于 step 窗口内，满足 token-meter replay 约束；机制与官方 `@deepseek-ai/dsh-time-context` 同源。

## 配置

```yaml
- id: message-datetime
  name: dsh-message-datetime
  config:
    timeZone: Asia/Shanghai   # 可选：浏览器时区不可用时的回退显示时区（默认进程时区）
```

## 与官方 dsh-time-context 的区别

| 维度 | @deepseek-ai/dsh-time-context | dsh-message-datetime |
|------|-------------------------------|----------------------|
| 注入频率 | 每个 eligible step | 每 turn 两条（开场 + 收尾） |
| 单条体量 | 三行（时间 + 时区政策 + elapsed） | 单行 |
| 定位 | 严格时区政策解释（Schedule 场景，opt-in） | 轻量时钟感知 + 跨轮间隔感知（常驻） |

两者不建议同时启用（会双重时间注入）。

## 安装

```bash
dsh plugin --profile web add dsh-message-datetime
```

安装后无需手动改配置，插件自带的 `cordis.patch.yml` 自动挂载生效；`timeZone` 为可选回退项（见上文配置）。

从 GitHub 直装（源码安装，pnpm ≥10 需允许构建脚本）：

```bash
dsh plugin --profile web add github:john-walks-slow/dsh-message-datetime
# 首次 add 会被 pnpm 拦截：把 pnpm 提示的包名加入
# ~/.dsh/profiles/web/pnpm-workspace.yaml 的 allowBuilds 后重跑
```

## 权限与兼容

- **零权限**：无外部服务、无网络请求、无文件系统写入；仅向会话上下文追加两条 `user/message` 通知
- **依赖**：`@deepseek-ai/cordis` 4.0.2 / `@deepseek-ai/dsh-llm` 0.1.2-rc.1（与 dsh 0.1.2-rc.1 锁定版本对齐），Node ≥ 22.5
- **中断安全**：任何注入失败均降级为 warn，绝不打断 turn

## 本地开发

```bash
npm install
npm run build     # tsc → dist/src
npm test          # tsc(含 test) + node --test dist/test/*.test.js
```

本机 profile 接线（link 方式）：`/root/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 数组加 `"dsh-message-datetime"`，`dependencies` 加 `"dsh-message-datetime": "link:/root/projects/dsh-message-datetime"`，然后 `pnpm install`。

- 参考实现：`@deepseek-ai/dsh-time-context`（/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-time-context）
- 依赖必须显式声明在 `dependencies` 并本地安装（link 包 ESM 解析坑，见 dev-dsh-plugin 技能）

## 发新版

改动入库后一条命令完成测试、版本号、打包（`npm version` 会自动 commit 并打 tag）：

```bash
npm run release        # patch；较大更新改用：npm version minor 或 major
```

然后指纹发布并推送：

```bash
node ~/.agents/skills/npm-publish/scripts/publish-webauthn.cjs /tmp/dsh-message-datetime-<新版>.tgz
git push --follow-tags
```

发布后 `npm view dsh-message-datetime version` 复验。批量发多个包时，在指纹页勾选“5 分钟内同 IP 不再挑战”，一次指纹即可连发。
