/**
 * Timestamp formatting for per-turn clock readings.
 *
 * One reading is a single line with the weekday, the local date and time, the
 * numeric UTC offset, and the canonical IANA zone. The summary drops seconds
 * so a collapsed GUI notice row stays short; the reading keeps them.
 */

/** The label of a reading taken while the turn is running. */
const CURRENT_TIME_LABEL = "Current time:";
/** The label of a reading taken as the turn closes. */
const TURN_ENDED_LABEL = "Turn ended:";

/** The per-zone formatting pair behind durable clock readings. */
export interface TimestampFormatter {
	/** Canonical IANA zone the readings display. */
	readonly zone: string;
	/** Full model-facing reading, e.g. `Current time: Tue 2026-09-15 01:04:34 +08:00 (Asia/Shanghai)`. */
	formatReading(now: number): string;
	/** One-line GUI summary without seconds, e.g. `Current time: Tue 2026-09-15 01:04 +08:00`. */
	formatSummary(now: number): string;
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
	const render = (now: number, label: string, withSeconds: boolean): string => {
		const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
		const offset = parts.timeZoneName.replace(/^GMT$/, "GMT+00:00").slice(3);
		const time = withSeconds ? `${parts.hour}:${parts.minute}:${parts.second}` : `${parts.hour}:${parts.minute}`;
		return `${label} ${parts.weekday} ${parts.year}-${parts.month}-${parts.day} ${time} ${offset} (${canonicalZone})`;
	};
	return {
		zone: canonicalZone,
		formatReading: (now) => render(now, CURRENT_TIME_LABEL, true),
		formatSummary: (now) => render(now, CURRENT_TIME_LABEL, false),
		formatEndedReading: (now) => render(now, TURN_ENDED_LABEL, true),
		formatEndedSummary: (now) => render(now, TURN_ENDED_LABEL, false)
	};
}
