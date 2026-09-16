/**
 * dsh-message-datetime — per-turn clock context for DeepSeek Harness.
 *
 * Every turn's first step appends exactly one short durable reading of the
 * current time (weekday, date, time, UTC offset, IANA zone) as a
 * plugin-attributed notice, and the turn's `agent/turn-stopping` boundary
 * appends one closing reading of when the turn ended, so the model always
 * knows what "now" is and when the previous round finished — for date math,
 * "today" phrasing, idle-gap awareness, and dated artifact paths — without
 * asking.
 *
 * The opening reading rides the same mechanism as the official
 * dsh-time-context package: an `agent/pre-step` listener that delegates first
 * and appends its message to the admitted decision, which the agent loop
 * persists as `user/message` inside the open step window. The closing reading
 * instead appends directly to the session log at the `agent/turn-stopping`
 * boundary — after the last `step/end`, before `turn/end` — where a
 * `user/message` is invariant-legal. Later steps of a turn get no second
 * reading; every reading is written once, append-only, so the request prefix
 * stays KV-cache reusable. Turns that close without a completed final step —
 * abort, error, rejection, or empty input — never reach `agent/turn-stopping`
 * and simply carry no closing reading. In the loop's rare dispatch-then-
 * withdraw race the closing reading may be followed by a queued next turn
 * within the same close; the duplicate reading is harmless presentation.
 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import { boundContextSummary, createUserMessage } from "@deepseek-ai/dsh-llm";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { selectRequestTimeZone } from "./request-zone.js";
import { createTimestampFormatter } from "./timestamp.js";
import type { TimestampFormatter } from "./timestamp.js";

/** Cordis plugin name used by loader diagnostics and message attribution. */
export const name = "dsh-message-datetime";
/** The agent registry whose pre-step waterfall carries the injection. */
export const inject = ["agents"];

/** Schemastery validation; the GUI settings panel renders it as a form. */
export const Config = z.object({
	timeZone: z.string().description("浏览器时区不可用时的回退显示时区（IANA，默认进程时区）")
});

/** Zone resolution and clock access behind one reading; formatters are cached per zone. */
export interface Clock {
	readonly fallbackZone: string;
	formatterFor(zone: string): TimestampFormatter;
	now(): number;
}

/** Remembers the display zone each agent's latest opening reading used, keyed by agent object. */
export type ZoneMemory = WeakMap<object, string>;

/** The minimal session surface a turn-end notice appends through. */
export interface NoticeSession {
	append(type: "user/message", data: UserMessage, options: { surfaceOp: "append" }): unknown;
}

/** The minimal runtime agent facade the turn-stopping listener needs. */
export interface NoticeAgent {
	session: NoticeSession;
}

/** Build one durable clock-reading notice in one display zone. */
function readingNotice(formatReading: (now: number) => string, formatSummary: (now: number) => string, now: number): UserMessage {
	return createUserMessage({
		content: [{ type: "text", text: formatReading(now) }],
		source: {
			kind: "plugin",
			plugin: name,
			form: "notice",
			summary: boundContextSummary(formatSummary(now))
		}
	});
}

/**
 * Compose the clock reading for one proposed step.
 * @returns The notice message to append, or `undefined` when this step must not carry one.
 */
export function composeReading(step: number, aborted: boolean, messages: readonly UserMessage[], clock: Clock): UserMessage | undefined {
	if (aborted || step !== 1) return undefined;
	const formatter = clock.formatterFor(selectRequestTimeZone(messages, clock.fallbackZone));
	return readingNotice((now) => formatter.formatReading(now), (now) => formatter.formatSummary(now), clock.now());
}

/**
 * Build the pre-step listener around one clock. Exposed for tests; `apply` is
 * the only production caller.
 *
 * A reading is presentation, never a turn prerequisite: if composing it throws
 * for any reason, the error is reported through `onError` and the step
 * proceeds with the decision untouched. When a reading is composed, the
 * display zone it used is remembered for this agent's turn-end notice.
 */
export function preStepHandler(clock: Clock, onError: (error: unknown) => void, zones: ZoneMemory = new WeakMap()) {
	return async (
		payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
		next: () => Promise<PreStepDecision>
	): Promise<PreStepDecision> => {
		const decision = await next();
		if (decision.kind !== "enter") return decision;
		let reading: UserMessage | undefined;
		try {
			reading = composeReading(payload.step, payload.signal.aborted, decision.messages, clock);
			if (reading === undefined) return decision;
			zones.set(payload.agent, selectRequestTimeZone(decision.messages, clock.fallbackZone));
		} catch (error) {
			onError(error);
			return decision;
		}
		return { ...decision, messages: [...decision.messages, reading] };
	};
}

/**
 * Build the turn-stopping listener around one clock. Exposed for tests;
 * `apply` is the only production caller.
 *
 * The closing reading reuses the display zone of the agent's latest opening
 * reading, falling back to the configured zone when none was composed. It is
 * presentation as well: any failure is reported through `onError` and the
 * turn still closes with its own end reason, because a throwing serial
 * listener would corrupt `turn/end`.
 */
export function turnStoppingHandler(clock: Clock, onError: (error: unknown) => void, zones: ZoneMemory = new WeakMap()) {
	return async (payload: { agent: NoticeAgent; turn: number; signal: AbortSignal }): Promise<void> => {
		if (payload.signal.aborted) return;
		try {
			const formatter = clock.formatterFor(zones.get(payload.agent) ?? clock.fallbackZone);
			const now = clock.now();
			payload.agent.session.append("user/message", readingNotice((at) => formatter.formatEndedReading(at), (at) => formatter.formatEndedSummary(at), now), { surfaceOp: "append" });
		} catch (error) {
			onError(error);
		}
	};
}

/**
 * Register the prepended per-turn clock listeners for the lifetime of `ctx`.
 * @throws when the configured time zone cannot be resolved.
 */
export function apply(ctx: Context, config: { timeZone?: string } = {}) {
	let fallbackFormatter: TimestampFormatter;
	try {
		fallbackFormatter = createTimestampFormatter(config.timeZone);
	} catch (error) {
		throw new Error(`dsh-message-datetime: invalid IANA timeZone ${JSON.stringify(config.timeZone)}`, { cause: error });
	}
	const formatters = new Map<string, TimestampFormatter>([[fallbackFormatter.zone, fallbackFormatter]]);
	const clock: Clock = {
		fallbackZone: fallbackFormatter.zone,
		formatterFor: (zone) => {
			const existing = formatters.get(zone);
			if (existing !== undefined) return existing;
			const created = createTimestampFormatter(zone);
			formatters.set(created.zone, created);
			return created;
		},
		now: () => Date.now()
	};
	const zones: ZoneMemory = new WeakMap();
	const onError = (error: unknown) => {
		ctx.logger.warn(`dsh-message-datetime: skipped a reading after a failure: ${String(error)}`);
	};
	ctx.on("agent/pre-step", preStepHandler(clock, onError, zones), { prepend: true });
	ctx.on("agent/turn-stopping", turnStoppingHandler(clock, onError, zones));
}
