import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { IDataObject } from 'n8n-workflow';

/**
 * The API's own examples, copied out of the manifest by `scripts/generate.mjs`, so the fake API answers with what
 * BlueBot really sends and the tests run without the rest of the repository.
 */
interface Examples {
	apiVersion: string;
	operations: Record<string, { method: string; path: string; status: number; request: IDataObject | null; response: IDataObject | null }>;
	events: Record<string, IDataObject>;
	errors: Record<string, { status: number; hint: string; doc_url: string }>;
}

export const EXAMPLES = JSON.parse(readFileSync(fileURLToPath(new URL('./examples.generated.json', import.meta.url)), 'utf8')) as Examples;

/** A copy of one operation's example answer. */
export function responseOf(operationId: string): IDataObject {
	const operation = EXAMPLES.operations[operationId];
	if (!operation) throw new Error(`The manifest has no operation ${operationId}.`);
	return structuredClone(operation.response ?? {});
}

/** A copy of one event's example. */
export function eventOf(type: string): IDataObject {
	const event = EXAMPLES.events[type];
	if (!event) throw new Error(`The manifest has no event ${type}.`);
	return structuredClone(event);
}

/** One page of a list, as BlueBot answers `GET` on a collection. */
export function page(data: IDataObject[], nextCursor: string | null): IDataObject {
	return { object: 'list', data, has_more: nextCursor !== null, next_cursor: nextCursor };
}
