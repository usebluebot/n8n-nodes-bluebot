import { createHash, randomUUID } from 'crypto';
import type { IExecuteFunctions } from 'n8n-workflow';

const MAX_KEY_LENGTH = 255;

/**
 * The key a POST is sent with when the workflow sets none: the execution, the node and the item's index. A retry
 * of the same execution (Retry On Fail, or the node's own retries) sends the same key, so BlueBot answers the first
 * response again rather than sending a second text.
 */
export function defaultIdempotencyKey(this: IExecuteFunctions, itemIndex: number): string {
	let execution = '';
	try {
		execution = String(this.getExecutionId() ?? '');
	} catch {
		// Some test runs of a single node have no execution id; such a run makes a key of its own below.
	}
	const node = this.getNode();
	const nodePart = node.id || node.name;
	return fitKey(`n8n-${execution || randomUUID()}-${nodePart}-${itemIndex}`);
}

/** A key for a step inside one item's call (each upload before a send), derived from that call's key. */
export function derivedKey(key: string, suffix: string): string {
	const candidate = `${key}:${suffix}`;
	if (candidate.length <= MAX_KEY_LENGTH) return candidate;
	return `${createHash('sha256').update(key).digest('hex')}:${suffix}`.slice(0, MAX_KEY_LENGTH);
}

/** BlueBot takes keys of 1 to 255 characters; a longer one is shortened to a hash that stays the same. */
export function fitKey(key: string): string {
	const trimmed = key.trim();
	if (trimmed.length <= MAX_KEY_LENGTH) return trimmed;
	return createHash('sha256').update(trimmed).digest('hex');
}
