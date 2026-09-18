# dsh-message-datetime

<p align="center">
  <a href="./README.md"><strong>简体中文</strong></a> ·
  <a href="./README.en.md"><strong>English</strong></a>
</p>

A DeepSeek Harness (cordis) plugin that injects a **concise timestamp and cross-turn idle interval** into the model context at the start of every conversation turn.

The model always knows "what time it is right now, what weekday it is, when the previous turn ended, and how long it has been idle" — date arithmetic, "today/tomorrow" semantics, idle-gap awareness across turns, and yymmdd path naming no longer require asking the user or guessing.

## What the model sees

The first step of every turn appends a one-line notice after the user message (~30-50 tokens, append-only, KV-cache friendly):

**First turn (no previous turn history):**
```
Current time: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai)
```

**Subsequent turns (combining previous turn end and idle duration):**
```
Current time: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai) | Last turn ended: Tue 2026-09-15 00:39:34 +08:00 (idle for 25m)
```

The notice renders in the GUI as a collapsed context chip (not a user bubble); the collapsed row shows a seconds-free summary and idle time (e.g. `Current time: Tue 2026-09-15 01:04 +08:00 (idle 25m)`), and clicking expands the full text.

## Behavior rules & design philosophy

- **Exactly one injection per turn (at turn start)**: injected only at `step === 1`; later steps within the turn (tool-call continuations) do not repeat it.
- **Preserves native DSH turn branching (fork)**: does not append trailing nodes after the assistant response at turn end, avoiding violations of the Web UI `turn-tail` boundary check, ensuring seamless session branching from any completed turn.
- **Ready-to-use cross-turn awareness**: instead of forcing the model to calculate time deltas across chat history, the plugin parses the previous `turn/end` event from session history and computes human-friendly idle intervals (`<1m`, `25m`, `1h 10m`, `2d 5h`).
- **Covers every session**: user turns, goal auto-continuation rounds, and subagent turns all get injections (subagents have no browser context and need the clock most).
- **Timezone resolution chain**: the browser-reported timezone for this turn (`clientTimeZone`, adopted only when unique) → the configured `timeZone` fallback → the Node process timezone. Invalid values fall back silently and never interrupt the turn.
- **Replay-safe**: reading is `user/message` (plugin-attributed notice) inside the step window, satisfying the token-meter replay constraint; the mechanism follows the official `@deepseek-ai/dsh-time-context`.

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

## Release a new version

One command runs tests, bumps the version and packs (`npm version` also commits and tags):

```bash
npm run release        # patch; for bigger changes: npm version minor or major
```

Then publish with the fingerprint flow and push:

```bash
node ~/.agents/skills/npm-publish/scripts/publish-webauthn.cjs /tmp/dsh-message-datetime-<newver>.tgz
git push --follow-tags
```

Verify with `npm view dsh-message-datetime version`. When releasing several packages, check "do not challenge for the next 5 minutes" on the webauthn page to publish them all with one fingerprint.
