import { test } from "node:test";
import assert from "node:assert/strict";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import { apply, findLastTurnEnd, preStepHandler } from "../src/index.js";
import { createTimestampFormatter } from "../src/timestamp.js";
import type { Clock } from "../src/index.js";

/** 2026-09-14T17:04:34Z — Tuesday 2026-09-15 01:04:34 in Asia/Shanghai, Monday 13:04:34 EDT in New York. */
const FIXED_NOW = Date.UTC(2026, 8, 14, 17, 4, 34);

const clock: Clock = {
	fallbackZone: "Asia/Shanghai",
	formatterFor: (zone) => createTimestampFormatter(zone),
	now: () => FIXED_NOW
};

const composeErrors: unknown[] = [];

function plainUserMessage(): UserMessage {
	return createUserMessage({
		content: [{ type: "text", text: "hello" }],
		source: { kind: "user" }
	});
}

function browserMessage(zone: string): UserMessage {
	return createUserMessage({
		content: [{ type: "text", text: "hello" }],
		source: { kind: "user", rpcId: "rpc-1", clientTimeZone: zone } as never
	});
}

function run(
	step: number,
	messages: UserMessage[],
	signal: AbortSignal,
	decision: PreStepDecision,
	agent: Agent = {} as Agent
): Promise<PreStepDecision> {
	return preStepHandler(clock, (error) => composeErrors.push(error))(
		{ agent, messages, turn: 1, step, signal },
		async () => decision
	);
}

test("step 1 of a turn appends exactly one reading after the admitted messages", async () => {
	const userMessage = plainUserMessage();
	const decision = await run(1, [userMessage], new AbortController().signal, { kind: "enter", messages: [userMessage] });
	assert.equal(decision.kind, "enter");
	if (decision.kind !== "enter") return;
	assert.equal(decision.messages.length, 2);
	assert.equal(decision.messages[0], userMessage);
	const reading = decision.messages[1];
	assert.equal(reading.role, "user");
	assert.equal(reading.source.kind, "plugin");
	assert.equal(reading.source.plugin, "dsh-message-datetime");
	assert.equal(reading.source.form, "notice");
	assert.equal(reading.source.summary, "Current time: Tue 2026-09-15 01:04 +08:00 (Asia/Shanghai)");
	assert.equal(reading.content.length, 1);
	const block = reading.content[0];
	assert.equal(block.type, "text");
	assert.equal(block.text, "Current time: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai)");
});

test("step 1 combines previous turn end reading when session has a completed turn", async () => {
	const lastTurnEndTime = FIXED_NOW - (25 * 60 * 1000); // 25 mins ago: 00:39:34
	const agent = {
		session: {
			snapshotEvents: () => [
				{ type: "turn/start", time: lastTurnEndTime - 5000 },
				{ type: "turn/end", time: lastTurnEndTime }
			]
		}
	} as unknown as Agent;

	const userMessage = plainUserMessage();
	const decision = await run(1, [userMessage], new AbortController().signal, { kind: "enter", messages: [userMessage] }, agent);
	assert.equal(decision.kind, "enter");
	if (decision.kind !== "enter") return;
	const reading = decision.messages[1];
	assert.equal(reading.source.kind, "plugin");
	assert.equal(reading.source.form, "notice");
	assert.equal(reading.source.summary, "Current time: Tue 2026-09-15 01:04 +08:00 (Asia/Shanghai) (idle 25m)");
	const block = reading.content[0];
	assert.equal(block.type, "text");
	assert.equal(
		block.text,
		"Current time: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai) | Last turn ended: Tue 2026-09-15 00:39:34 +08:00 (idle for 25m)"
	);
});

test("findLastTurnEnd handles missing session, empty events, or invalid times gracefully", () => {
	assert.equal(findLastTurnEnd({} as Agent), undefined);
	assert.equal(findLastTurnEnd({ session: {} } as unknown as Agent), undefined);
	assert.equal(findLastTurnEnd({ session: { snapshotEvents: () => [] } } as unknown as Agent), undefined);
	assert.equal(findLastTurnEnd({ session: { snapshotEvents: () => [{ type: "turn/start" }] } } as unknown as Agent), undefined);
	assert.equal(findLastTurnEnd({ session: { snapshotEvents: () => [{ type: "turn/end", time: 12345 }] } } as unknown as Agent), 12345);
});

test("later steps of the same turn get no second reading", async () => {
	const userMessage = plainUserMessage();
	const enter: PreStepDecision = { kind: "enter", messages: [userMessage] };
	const decision = await run(2, [userMessage], new AbortController().signal, enter);
	assert.equal(decision, enter);
});

test("rejected decisions pass through untouched", async () => {
	const reject = { kind: "reject" } as const;
	const decision = await run(1, [plainUserMessage()], new AbortController().signal, reject);
	assert.equal(decision, reject);
});

test("aborted signals skip injection", async () => {
	const controller = new AbortController();
	controller.abort();
	const userMessage = plainUserMessage();
	const enter: PreStepDecision = { kind: "enter", messages: [userMessage] };
	const decision = await run(1, [userMessage], controller.signal, enter);
	assert.equal(decision, enter);
});

test("the turn's unique browser zone overrides the fallback", async () => {
	const userMessage = browserMessage("America/New_York");
	const decision = await run(1, [userMessage], new AbortController().signal, { kind: "enter", messages: [userMessage] });
	assert.equal(decision.kind, "enter");
	if (decision.kind !== "enter") return;
	const block = decision.messages[1].content[0];
	assert.equal(block.type, "text");
	assert.equal(block.text, "Current time: Mon 2026-09-14 13:04:34 -04:00 (America/New_York)");
});

test("request-series starts survive the injection", async () => {
	const userMessage = plainUserMessage();
	const decision = await run(1, [userMessage], new AbortController().signal, { kind: "enter", messages: [userMessage], startsRequestSeries: true });
	assert.equal(decision.kind, "enter");
	if (decision.kind !== "enter") return;
	assert.equal(decision.startsRequestSeries, true);
});

test("a compose failure reports the error and never breaks the step", async () => {
	const breaking: Clock = {
		fallbackZone: "Asia/Shanghai",
		formatterFor: () => {
			throw new Error("formatter explosion");
		},
		now: () => FIXED_NOW
	};
	const userMessage = plainUserMessage();
	const enter: PreStepDecision = { kind: "enter", messages: [userMessage] };
	const failures: unknown[] = [];
	const decision = await preStepHandler(breaking, (error) => failures.push(error))(
		{ agent: {} as Agent, messages: [userMessage], turn: 1, step: 1, signal: new AbortController().signal },
		async () => enter
	);
	assert.equal(decision, enter);
	assert.equal(failures.length, 1);
	assert.match(String(failures[0]), /formatter explosion/);
});

test("apply registers one prepended agent/pre-step listener whose handler injects", async () => {
	const registrations: Array<{ event: string; handler: unknown; options: unknown }> = [];
	const fakeCtx = {
		on: (event: string, handler: unknown, options: unknown) => registrations.push({ event, handler, options }),
		logger: { warn: () => {} }
	};
	apply(fakeCtx as never);
	assert.equal(registrations.length, 1);
	assert.equal(registrations[0].event, "agent/pre-step");
	assert.deepEqual(registrations[0].options, { prepend: true });
	const userMessage = plainUserMessage();
	const handler = registrations[0].handler as (payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>;
	const decision = await handler(
		{ agent: {} as Agent, messages: [userMessage], turn: 3, step: 1, signal: new AbortController().signal },
		async () => ({ kind: "enter", messages: [userMessage] })
	);
	assert.equal(decision.kind, "enter");
	if (decision.kind !== "enter") return;
	assert.equal(decision.messages.length, 2);
	const block = decision.messages[1].content[0];
	assert.equal(block.type, "text");
	assert.match(block.text, /^Current time: (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2} \(.+\)$/);
});

test("apply fails fast on an invalid configured time zone", () => {
	const fakeCtx = { on: () => {}, logger: { warn: () => {} } };
	assert.throws(
		() => apply(fakeCtx as never, { timeZone: "Mars/Olympus_Mons" }),
		/invalid IANA timeZone "Mars\/Olympus_Mons"/
	);
});
