/**
 * Display-zone selection for one turn's clock reading.
 *
 * The Host canonicalizes the browser zone onto user-rpc messages
 * (`source.clientTimeZone`). When every rpc-sourced message of the turn
 * carries the same browser zone, that zone owns the display; anything else —
 * no rpc source, disagreeing zones, or a value Intl cannot resolve — falls
 * back to the configured zone. Invalid values never throw: a presentation
 * guess must not break a turn.
 */
import type { UserMessage } from "@deepseek-ai/dsh-llm";

/** Read the Host-canonicalized browser zone from one user message, if present. */
function browserTimeZone(message: UserMessage): string | undefined {
	const source = message.source as { kind?: unknown; rpcId?: unknown; clientTimeZone?: unknown };
	if (source.kind !== "user" || typeof source.rpcId !== "string" || typeof source.clientTimeZone !== "string") return undefined;
	return source.clientTimeZone;
}

/**
 * Select the display zone for one turn's reading.
 * @param messages - Messages admitted for the turn's first step.
 * @param fallbackZone - Canonical zone used when the browser zone is absent, mixed, or unresolvable.
 * @returns The canonical display zone.
 */
export function selectRequestTimeZone(messages: readonly UserMessage[], fallbackZone: string): string {
	const zones = [...new Set(messages.flatMap((message) => {
		const zone = browserTimeZone(message);
		return zone === undefined ? [] : [zone];
	}))];
	if (zones.length !== 1) return fallbackZone;
	try {
		return new Intl.DateTimeFormat("en-US", { timeZone: zones[0] }).resolvedOptions().timeZone;
	} catch {
		return fallbackZone;
	}
}
