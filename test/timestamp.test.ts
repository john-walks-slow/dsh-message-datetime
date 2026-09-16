import { test } from "node:test";
import assert from "node:assert/strict";
import { createTimestampFormatter } from "../src/timestamp.js";

/** 2026-09-14T17:04:34Z — Tuesday 2026-09-15 01:04:34 in Asia/Shanghai. */
const TUE_MORNING_UTC = Date.UTC(2026, 8, 14, 17, 4, 34);

test("reading renders weekday, date, seconds, offset, and zone for Asia/Shanghai", () => {
	const formatter = createTimestampFormatter("Asia/Shanghai");
	assert.equal(formatter.zone, "Asia/Shanghai");
	assert.equal(formatter.formatReading(TUE_MORNING_UTC), "Current time: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai)");
	assert.equal(formatter.formatSummary(TUE_MORNING_UTC), "Current time: Tue 2026-09-15 01:04 +08:00 (Asia/Shanghai)");
});

test("turn-end readings reuse the same timestamp shape under the Turn ended label", () => {
	const formatter = createTimestampFormatter("Asia/Shanghai");
	assert.equal(formatter.formatEndedReading(TUE_MORNING_UTC), "Turn ended: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai)");
	assert.equal(formatter.formatEndedSummary(TUE_MORNING_UTC), "Turn ended: Tue 2026-09-15 01:04 +08:00 (Asia/Shanghai)");
});

test("UTC renders +00:00 rather than a bare GMT marker", () => {
	const formatter = createTimestampFormatter("UTC");
	assert.equal(formatter.zone, "UTC");
	assert.equal(formatter.formatReading(TUE_MORNING_UTC), "Current time: Mon 2026-09-14 17:04:34 +00:00 (UTC)");
});

test("America/New_York crosses its fall-back boundary with the offset flipping", () => {
	const formatter = createTimestampFormatter("America/New_York");
	// 2026-11-01 05:30 UTC is 01:30 EDT (UTC-4); one hour later the clock reads 01:30 EST (UTC-5).
	const beforeFallBack = Date.UTC(2026, 10, 1, 5, 30, 0);
	const afterFallBack = Date.UTC(2026, 10, 1, 6, 30, 0);
	assert.equal(formatter.formatReading(beforeFallBack), "Current time: Sun 2026-11-01 01:30:00 -04:00 (America/New_York)");
	assert.equal(formatter.formatReading(afterFallBack), "Current time: Sun 2026-11-01 01:30:00 -05:00 (America/New_York)");
});

test("midnight renders as 00 through the h23 cycle", () => {
	const formatter = createTimestampFormatter("Asia/Shanghai");
	const midnight = Date.UTC(2026, 8, 14, 16, 0, 0);
	assert.equal(formatter.formatReading(midnight), "Current time: Tue 2026-09-15 00:00:00 +08:00 (Asia/Shanghai)");
});

test("omitted zone resolves the process zone and keeps the same shape", () => {
	const formatter = createTimestampFormatter();
	assert.equal(formatter.zone, new Intl.DateTimeFormat().resolvedOptions().timeZone);
	const reading = formatter.formatReading(TUE_MORNING_UTC);
	assert.match(reading, /^Current time: (Mon|Tue|Sun|Sat|Fri|Thu|Wed) \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2} \(.+\)$/);
	assert.ok(reading.includes(`(${formatter.zone})`));
});

test("unresolvable zones throw so bad config fails fast at startup", () => {
	assert.throws(() => createTimestampFormatter("Mars/Olympus_Mons"), RangeError);
});
