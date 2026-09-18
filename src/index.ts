/**
 * dsh-message-datetime — per-turn clock context for DeepSeek Harness.
 *
 * Every turn's first step appends exactly one short durable reading of the
 * current time (weekday, date, time, UTC offset, IANA zone) as a
 * plugin-attributed notice. If a previous turn ended in this session, the
 * reading seamlessly incorporates the previous turn's end time and idle duration,
 * so the model always knows what "now" is and when the previous round finished —
 * for date math, "today" phrasing, idle-gap awareness, and dated artifact paths —
 * without asking, and without polluting turn endings or breaking the Web UI's
 * turn branching (fork) capability.
 *
 * The reading rides an `agent/pre-step` listener that delegates first and appends
 * its message to the admitted decision, which the agent loop persists as
 * `user/message` inside the open step window. Later steps of a turn get no second
 * reading; every reading is written once, append-only, so the request prefix
 * stays KV-cache reusable.
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
 * Extract the previous completed turn's end timestamp from the agent session, if any.
 */
export function findLastTurnEnd(agent: Agent): number | undefined {
	try {
		const session = (agent as { session?: { snapshotEvents?: () => readonly { type: string; time?: number }[] } }).session;
		if (typeof session?.snapshotEvents !== "function") return undefined;
		const events = session.snapshotEvents();
		for (let i = events.length - 1; i >= 0; i--) {
			const event = events[i];
			if (event?.type === "turn/end") {
				return typeof event.time === "number" ? event.time : undefined;
			}
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Compose the clock reading for one proposed step.
 * @returns The notice message to append, or `undefined` when this step must not carry one.
 */
export function composeReading(
	step: number,
	aborted: boolean,
	messages: readonly UserMessage[],
	clock: Clock,
	lastTurnEnd?: number
): UserMessage | undefined {
	if (aborted || step !== 1) return undefined;
	const formatter = clock.formatterFor(selectRequestTimeZone(messages, clock.fallbackZone));
	return readingNotice(
		(now) => formatter.formatReading(now, lastTurnEnd),
		(now) => formatter.formatSummary(now, lastTurnEnd),
		clock.now()
	);
}

/**
 * Build the pre-step listener around one clock. Exposed for tests; `apply` is
 * the only production caller.
 *
 * A reading is presentation, never a turn prerequisite: if composing it throws
 * for any reason, the error is reported through `onError` and the step
 * proceeds with the decision untouched.
 */
export function preStepHandler(clock: Clock, onError: (error: unknown) => void) {
	return async (
		payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
		next: () => Promise<PreStepDecision>
	): Promise<PreStepDecision> => {
		const decision = await next();
		if (decision.kind !== "enter") return decision;
		let reading: UserMessage | undefined;
		try {
			const lastTurnEnd = findLastTurnEnd(payload.agent);
			reading = composeReading(payload.step, payload.signal.aborted, decision.messages, clock, lastTurnEnd);
			if (reading === undefined) return decision;
		} catch (error) {
			onError(error);
			return decision;
		}
		return { ...decision, messages: [...decision.messages, reading] };
	};
}

/**
 * Register the prepended per-turn clock listener for the lifetime of `ctx`.
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
	const onError = (error: unknown) => {
		ctx.logger.warn(`dsh-message-datetime: skipped a reading after a failure: ${String(error)}`);
	};
	ctx.on("agent/pre-step", preStepHandler(clock, onError), { prepend: true });
}
