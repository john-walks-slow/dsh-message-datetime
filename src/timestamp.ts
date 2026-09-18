/**
 * Timestamp formatting for per-turn clock readings.
 *
 * One reading is a single line with the weekday, the local date and time, the
 * numeric UTC offset, and the canonical IANA zone. The summary drops seconds
 * so a collapsed GUI notice row stays short; the reading keeps them.
 * When previous turn end time is available, the reading and summary append
 * the previous turn's end time and idle duration.
 */

/** The label of a reading taken while the turn is running. */
const CURRENT_TIME_LABEL = "Current time:";
/** The label of a reading taken as the turn closes. */
const TURN_ENDED_LABEL = "Turn ended:";
/** The label for the previous turn's end time in the combined reading. */
const LAST_TURN_ENDED_LABEL = "Last turn ended:";

/**
 * Format the idle duration between the previous turn and the current reading.
 * @param diffMs - Milliseconds elapsed since the previous turn ended.
 * @returns Human-friendly short representation like `<1m`, `12m`, `1h 23m`, `2d 5h`.
 */
export function formatIdleDuration(diffMs: number): string {
	const clampedMs = Math.max(0, diffMs);
	if (clampedMs < 60_000) return "<1m";
	const totalMinutes = Math.floor(clampedMs / 60_000);
	if (totalMinutes < 60) return `${totalMinutes}m`;
	const totalHours = Math.floor(totalMinutes / 60);
	const remainingMinutes = totalMinutes % 60;
	if (totalHours < 24) {
		return remainingMinutes === 0 ? `${totalHours}h` : `${totalHours}h ${remainingMinutes}m`;
	}
	const days = Math.floor(totalHours / 24);
	const remainingHours = totalHours % 24;
	return remainingHours === 0 ? `${days}d` : `${days}d ${remainingHours}h`;
}

/** The per-zone formatting pair behind durable clock readings. */
export interface TimestampFormatter {
	/** Canonical IANA zone the readings display. */
	readonly zone: string;
	/** Full model-facing reading, e.g. `Current time: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai)` or with last turn end. */
	formatReading(now: number, lastTurnEnd?: number): string;
	/** One-line GUI summary without seconds, e.g. `Current time: Tue 2026-09-15 01:04 +08:00` or with idle duration. */
	formatSummary(now: number, lastTurnEnd?: number): string;
	/** Full model-facing reading of the turn's end, e.g. `Turn ended: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai)`. */
	formatEndedReading(now: number): string;
	/** One-line GUI summary of the turn's end without seconds, e.g. `Turn ended: Tue 2026-09-15 01:04 +08:00`. */
	formatEndedSummary(now: number): string;
}

/**
 * Create the formatter for one display zone, or the process zone when omitted.
 * @throws RangeError when `zone` cannot be resolved by Intl.
 */
export function createTimestampFormatter(zone?: string): TimestampFormatter {
	const formatter = new Intl.DateTimeFormat("en-US", {
		...(zone === undefined ? {} : { timeZone: zone }),
		weekday: "short",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
		timeZoneName: "longOffset"
	});
	const canonicalZone = formatter.resolvedOptions().timeZone;
	const partsOf = (timestamp: number, withSeconds: boolean) => {
		const parts = Object.fromEntries(formatter.formatToParts(timestamp).map((part) => [part.type, part.value]));
		const offset = parts.timeZoneName.replace(/^GMT$/, "GMT+00:00").slice(3);
		const time = withSeconds ? `${parts.hour}:${parts.minute}:${parts.second}` : `${parts.hour}:${parts.minute}`;
		return { parts, offset, time };
	};
	const render = (now: number, label: string, withSeconds: boolean): string => {
		const { parts, offset, time } = partsOf(now, withSeconds);
		return `${label} ${parts.weekday} ${parts.year}-${parts.month}-${parts.day} ${time} ${offset} (${canonicalZone})`;
	};
	return {
		zone: canonicalZone,
		formatReading: (now, lastTurnEnd) => {
			const current = render(now, CURRENT_TIME_LABEL, true);
			if (lastTurnEnd === undefined) return current;
			const { parts, offset, time } = partsOf(lastTurnEnd, true);
			const idle = formatIdleDuration(now - lastTurnEnd);
			return `${current} | ${LAST_TURN_ENDED_LABEL} ${parts.weekday} ${parts.year}-${parts.month}-${parts.day} ${time} ${offset} (idle for ${idle})`;
		},
		formatSummary: (now, lastTurnEnd) => {
			const current = render(now, CURRENT_TIME_LABEL, false);
			if (lastTurnEnd === undefined) return current;
			const idle = formatIdleDuration(now - lastTurnEnd);
			return `${current} (idle ${idle})`;
		},
		formatEndedReading: (now) => render(now, TURN_ENDED_LABEL, true),
		formatEndedSummary: (now) => render(now, TURN_ENDED_LABEL, false)
	};
}
