# dsh-message-datetime

<p align="center">
  <a href="./README.md"><strong>简体中文</strong></a> ·
  <a href="./README.en.md"><strong>English</strong></a>
</p>

A DeepSeek Harness (cordis) plugin that injects a **one-line timestamp** into the model context at the start and the end of every conversation turn.

The model always knows "what time it is right now, what weekday it is, when the previous turn ended" — date arithmetic, "today/tomorrow" semantics, idle-gap awareness across turns, and yymmdd path naming no longer require asking the user or guessing.

## What the model sees

The first step of every turn appends a one-line notice after the user message (~30 tokens, append-only, KV-cache friendly):

```
Current time: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai)
```

When the turn finishes normally (the `agent/turn-stopping` boundary, after the last step/end and before turn/end), a one-line closing reading is appended:

```
Turn ended: Tue 2026-09-15 01:41:20 +08:00 (Asia/Shanghai)
```

The next turn therefore reads the previous turn's end time directly. Both notices render in the GUI as collapsed context chips (not user bubbles); the collapsed row shows a seconds-free summary and clicking expands the full text.

![dsh-message-datetime in the DSH web UI: Current time and Turn ended context injection chips in a demo turn](assets/screenshot-1.png)

## Behavior rules

- **Exactly two readings per turn**: the opening reading is injected only at `step === 1`; later steps within the turn (tool-call continuations) do not repeat it. The closing reading is injected when the turn ends normally.
- **Interrupted turns get no closing reading**: abort / error / empty-input paths never dispatch `agent/turn-stopping`; the interrupted turn only records its reason on the `turn/end` event, with no notice.
- **The closing reading never breaks turn teardown**: turn-stopping dispatch is serial; any listener failure degrades to a warn and never throws (throwing would pollute the turn's `turn/end` reason as error).
- **Consistent timezone**: the closing reading reuses the timezone chosen for this turn's opening reading (falling back to the configured timezone if absent) — the two readings always agree.
- **Covers every session**: user turns, goal auto-continuation rounds, and subagent turns all get injections (subagents have no browser context and need the clock most).
- **Timezone resolution chain**: the browser-reported timezone for this turn (`clientTimeZone`, adopted only when unique) → the configured `timeZone` fallback → the Node process timezone. Invalid values fall back silently and never interrupt the turn.
- **Replay-safe**: both readings are `user/message` (plugin-attributed notices) — the opening one inside the step window, the closing one in the inter-turn position before `turn/end` (the dsh-session invariant places no position constraint on `user/message`), satisfying the token-meter replay constraint; the mechanism follows the official `@deepseek-ai/dsh-time-context`.

## Configuration

```yaml
- id: message-datetime
  name: dsh-message-datetime
  config:
    timeZone: Asia/Shanghai   # optional: fallback display timezone when the browser timezone is unavailable (defaults to the process timezone)
```

## Differences from the official dsh-time-context

| Dimension | @deepseek-ai/dsh-time-context | dsh-message-datetime |
|------|-------------------------------|----------------------|
| Injection frequency | every eligible step | two per turn (opening + closing) |
| Size per reading | three lines (time + timezone policy + elapsed) | one line |
| Positioning | strict timezone-policy explanation (Schedule scenarios, opt-in) | lightweight clock awareness + cross-turn gap awareness (always-on) |

Enabling both at once is not recommended (double time injection).

## Install

```bash
dsh plugin --profile web add dsh-message-datetime
```

No manual configuration needed after install — the bundled `cordis.patch.yml` mounts automatically; `timeZone` is an optional fallback (see Configuration above).

Install straight from GitHub (source install; pnpm ≥10 requires allowing the build script):

```bash
dsh plugin --profile web add github:john-walks-slow/dsh-message-datetime
# The first add is blocked by pnpm: add the package name pnpm prints to
# allowBuilds in ~/.dsh/profiles/web/pnpm-workspace.yaml, then re-run
```

## Permissions & compatibility

- **Zero permissions**: no external services, no network requests, no filesystem writes; only appends two `user/message` notices to the session context
- **Dependencies**: `@deepseek-ai/cordis` 4.0.2 / `@deepseek-ai/dsh-llm` 0.1.2-rc.1 (aligned with dsh 0.1.2-rc.1 locked versions), Node ≥ 22.5
- **Interrupt-safe**: any injection failure degrades to a warn and never breaks the turn

## Local development

```bash
npm install
npm run build     # tsc → dist/src
npm test          # tsc(incl. test) + node --test dist/test/*.test.js
```

- Reference implementation: `@deepseek-ai/dsh-time-context`
- Runtime `@deepseek-ai/*` imports must be declared in `dependencies` and installed locally (link-package ESM resolution pitfall)
