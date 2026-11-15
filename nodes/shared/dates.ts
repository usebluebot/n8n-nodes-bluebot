const NAIVE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/;
const ZONED = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Turns a date and time from n8n into the ISO 8601 time with an offset that BlueBot asks for. n8n's date picker
 * gives a time with no zone ("2026-11-14T15:00:00"), which is read in the workflow's time zone; an expression may
 * give a Luxon DateTime, a Date or a string that already has a zone, which is kept as that instant.
 */
export function toApiDateTime(value: unknown, timeZone: string): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
	if (typeof value === 'object') {
		const toISO = (value as { toISO?: unknown }).toISO;
		if (typeof toISO === 'function') {
			const iso: unknown = toISO.call(value);
			return typeof iso === 'string' ? toApiDateTime(iso, timeZone) : undefined;
		}
		return String(value);
	}
	const text = String(value).trim();
	if (!text) return undefined;
	if (ZONED.test(text)) {
		const instant = Date.parse(text);
		return Number.isNaN(instant) ? text : new Date(instant).toISOString();
	}
	const match = NAIVE.exec(text);
	if (!match) return text;
	const [, year, month, day, hour = '0', minute = '0', second = '0', fraction = '0'] = match;
	const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(fraction.padEnd(3, '0').slice(0, 3)));
	return new Date(wallTimeToInstant(wall, timeZone)).toISOString();
}

/** The instant at which the clock in `timeZone` shows `wall` (a wall time written as if it were UTC). */
function wallTimeToInstant(wall: number, timeZone: string): number {
	const first = wall - offsetAt(wall, timeZone);
	const second = wall - offsetAt(first, timeZone);
	return second;
}

/** How far ahead of UTC the clock in `timeZone` is at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
	let format: Intl.DateTimeFormat;
	try {
		format = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		});
	} catch {
		return 0;
	}
	const parts: Record<string, number> = {};
	for (const part of format.formatToParts(new Date(instant))) {
		if (part.type !== 'literal') parts[part.type] = Number(part.value);
	}
	const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
	const whole = instant - (((instant % 1000) + 1000) % 1000);
	return shown - whole;
}
