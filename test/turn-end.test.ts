import { test } from "node:test";
import assert from "node:assert/strict";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import { apply, preStepHandler, turnStoppingHandler } from "../src/index.js";
import type { Clock, NoticeAgent } from "../src/index.js";
import { createTimestampFormatter } from "../src/timestamp.js";

/** 2026-09-14T17:04:34Z — Tuesday 2026-09-15 01:04:34 in Asia/Shanghai, Monday 13:04:34 EDT in New York. */
const FIXED_NOW = Date.UTC(2026, 8, 14, 17, 4, 34);

const clock: Clock = {
	fallbackZone: "Asia/Shanghai",
	formatterFor: (zone) => createTimestampFormatter(zone),
	now: () => FIXED_NOW
};

interface AppendedEvent {
	type: string;
	data: UserMessage;
	options: unknown;
}

function appendRecordingAgent(appends: AppendedEvent[]): NoticeAgent {
	return { session: { append: (type: string, data: UserMessage, options: unknown) => appends.push({ type, data, options }) } } as unknown as NoticeAgent;
}

function browserMessage(zone: string): UserMessage {
	return createUserMessage({
		content: [{ type: "text", text: "hello" }],
		source: { kind: "user", rpcId: "rpc-1", clientTimeZone: zone } as never
	});
}

function plainUserMessage(): UserMessage {
	return createUserMessage({
		content: [{ type: "text", text: "hello" }],
		source: { kind: "user" }
	});
}

function runPreStep(zones: WeakMap<object, string>, agent: Agent, message: UserMessage): Promise<PreStepDecision> {
	return preStepHandler(clock, () => {}, zones)(
		{ agent, messages: [message], turn: 1, step: 1, signal: new AbortController().signal },
		async () => ({ kind: "enter", messages: [message] })
	);
}

test("the turn-end notice reuses the zone of the agent's latest opening reading", async () => {
	const zones = new WeakMap<object, string>();
	const appends: AppendedEvent[] = [];
	const agent = appendRecordingAgent(appends);
	const message = browserMessage("America/New_York");
	await runPreStep(zones, agent as unknown as Agent, message);
	await turnStoppingHandler(clock, () => {}, zones)({ agent, turn: 1, signal: new AbortController().signal });
	assert.equal(appends.length, 1);
	assert.equal(appends[0].type, "user/message");
	assert.deepEqual(appends[0].options, { surfaceOp: "append" });
	const notice = appends[0].data;
	assert.equal(notice.role, "user");
	assert.equal(notice.source.kind, "plugin");
	assert.equal(notice.source.plugin, "dsh-message-datetime");
	assert.equal(notice.source.form, "notice");
	assert.equal(notice.source.summary, "Turn ended: Mon 2026-09-14 13:04 -04:00 (America/New_York)");
	const block = notice.content[0];
	assert.equal(block.type, "text");
	assert.equal(block.text, "Turn ended: Mon 2026-09-14 13:04:34 -04:00 (America/New_York)");
});

test("an agent without a cached zone falls back to the configured zone", async () => {
	const appends: AppendedEvent[] = [];
	const agent = appendRecordingAgent(appends);
	await turnStoppingHandler(clock, () => {}, new WeakMap())({ agent, turn: 1, signal: new AbortController().signal });
	assert.equal(appends.length, 1);
	const block = appends[0].data.content[0];
	assert.equal(block.type, "text");
	assert.equal(block.text, "Turn ended: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai)");
});

test("an aborted turn carries no closing reading", async () => {
	const appends: AppendedEvent[] = [];
	const agent = appendRecordingAgent(appends);
	const controller = new AbortController();
	controller.abort();
	await turnStoppingHandler(clock, () => {}, new WeakMap())({ agent, turn: 1, signal: controller.signal });
	assert.equal(appends.length, 0);
});

test("an append failure reports through onError and never escapes the listener", async () => {
	const failures: unknown[] = [];
	const agent = { session: { append: () => { throw new Error("log sealed"); } } } as unknown as NoticeAgent;
	await turnStoppingHandler(clock, (error) => failures.push(error), new WeakMap())({ agent, turn: 1, signal: new AbortController().signal });
	assert.equal(failures.length, 1);
	assert.match(String(failures[0]), /log sealed/);
});

test("a formatter failure reports through onError and never escapes the listener", async () => {
	const failures: unknown[] = [];
	const breaking: Clock = {
		fallbackZone: "Asia/Shanghai",
		formatterFor: () => {
			throw new Error("formatter explosion");
		},
		now: () => FIXED_NOW
	};
	const agent = appendRecordingAgent([]);
	await turnStoppingHandler(breaking, (error) => failures.push(error), new WeakMap())({ agent, turn: 1, signal: new AbortController().signal });
	assert.equal(failures.length, 1);
	assert.match(String(failures[0]), /formatter explosion/);
});

test("the closing reading follows the latest opening reading when the zone switches", async () => {
	const zones = new WeakMap<object, string>();
	const appends: AppendedEvent[] = [];
	const agent = appendRecordingAgent(appends) as unknown as Agent;
	await runPreStep(zones, agent, browserMessage("America/New_York"));
	await runPreStep(zones, agent, plainUserMessage());
	await turnStoppingHandler(clock, () => {}, zones)({ agent: agent as unknown as NoticeAgent, turn: 2, signal: new AbortController().signal });
	assert.equal(appends.length, 1);
	const block = appends[0].data.content[0];
	assert.equal(block.type, "text");
	assert.equal(block.text, "Turn ended: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai)");
});

test("apply wires both listeners to share one zone memory", async () => {
	const registrations: Array<{ event: string; handler: unknown; options: unknown }> = [];
	const fakeCtx = {
		on: (event: string, handler: unknown, options: unknown) => registrations.push({ event, handler, options }),
		logger: { warn: () => {} }
	};
	apply(fakeCtx as never);
	assert.deepEqual(registrations.map((registration) => registration.event), ["agent/pre-step", "agent/turn-stopping"]);
	assert.deepEqual(registrations[0].options, { prepend: true });
	assert.equal(registrations[1].options, undefined);
	const appends: AppendedEvent[] = [];
	const agent = appendRecordingAgent(appends);
	const message = browserMessage("America/New_York");
	await (registrations[0].handler as (payload: unknown, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>)(
		{ agent, messages: [message], turn: 1, step: 1, signal: new AbortController().signal },
		async () => ({ kind: "enter", messages: [message] })
	);
	await (registrations[1].handler as (payload: unknown) => Promise<void>)({ agent, turn: 1, signal: new AbortController().signal });
	assert.equal(appends.length, 1);
	const block = appends[0].data.content[0];
	assert.equal(block.type, "text");
	// apply samples the real clock, so pin only the label shape; the New York offset and
	// zone prove the closing reading shared the opening reading's zone memory.
	assert.match(block.text, /^Turn ended: (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} -04:00 \(America\/New_York\)$/);
});
