import { test } from "node:test";
import assert from "node:assert/strict";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import { selectRequestTimeZone } from "../src/request-zone.js";

const FALLBACK = "Asia/Shanghai";

function message(source: object): UserMessage {
	return createUserMessage({
		content: [{ type: "text", text: "hello" }],
		source: source as never
	});
}

function browserMessage(zone: string): UserMessage {
	return message({ kind: "user", rpcId: "rpc-1", clientTimeZone: zone });
}

test("no rpc-sourced messages fall back", () => {
	assert.equal(selectRequestTimeZone([], FALLBACK), FALLBACK);
	assert.equal(selectRequestTimeZone([message({ kind: "user" })], FALLBACK), FALLBACK);
	assert.equal(selectRequestTimeZone([message({ kind: "plugin", plugin: "dsh-mnemon", form: "instructions" })], FALLBACK), FALLBACK);
});

test("a unique browser zone owns the display", () => {
	assert.equal(selectRequestTimeZone([browserMessage("Asia/Shanghai")], FALLBACK), "Asia/Shanghai");
	assert.equal(
		selectRequestTimeZone([browserMessage("Asia/Shanghai"), message({ kind: "user" }), browserMessage("Asia/Shanghai")], FALLBACK),
		"Asia/Shanghai"
	);
});

test("disagreeing browser zones fall back instead of guessing", () => {
	assert.equal(
		selectRequestTimeZone([browserMessage("Asia/Shanghai"), browserMessage("Europe/Berlin")], FALLBACK),
		FALLBACK
	);
});

test("an unresolvable browser zone falls back without throwing", () => {
	assert.equal(selectRequestTimeZone([browserMessage("Mars/Olympus_Mons")], FALLBACK), FALLBACK);
});

test("zone aliases canonicalize to their resolved IANA name", () => {
	assert.equal(selectRequestTimeZone([browserMessage("Asia/Chongqing")], FALLBACK), "Asia/Shanghai");
});
