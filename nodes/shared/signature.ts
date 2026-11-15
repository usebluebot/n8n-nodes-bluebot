import { createHmac, timingSafeEqual } from 'crypto';

/** BlueBot signs each delivery when it sends it; one older or newer than this is refused. */
export const TOLERANCE_SECONDS = 300;

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string | undefined {
	const value = headers[name] ?? headers[name.toLowerCase()];
	if (Array.isArray(value)) return value[0];
	return value;
}

/**
 * Checks a Standard Webhooks signature: HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${raw body}`, keyed
 * with the base64 part of the `whsec_` secret. `webhook-signature` holds one or more `v1,<base64>` values
 * separated by spaces (two while a secret is being rotated); any one matching is enough. The body must be the
 * bytes BlueBot sent, never JSON parsed and written out again.
 */
export function verifySignature(rawBody: Buffer | string, headers: Headers, secret: string, nowSeconds: number = Math.floor(Date.now() / 1000)): SignatureCheck {
	const id = header(headers, 'webhook-id');
	const timestamp = header(headers, 'webhook-timestamp');
	const signatures = header(headers, 'webhook-signature');
	if (!id || !timestamp || !signatures) return { ok: false, reason: 'The request has no webhook-id, webhook-timestamp or webhook-signature header.' };
	if (!/^\d+$/.test(timestamp.trim())) return { ok: false, reason: 'The webhook-timestamp header isn’t a Unix time.' };
	const sentAt = Number(timestamp.trim());
	if (Math.abs(nowSeconds - sentAt) > TOLERANCE_SECONDS) return { ok: false, reason: 'The request is more than five minutes old or from the future.' };

	const key = secretKey(secret);
	if (!key) return { ok: false, reason: 'The stored signing secret isn’t a whsec_ secret.' };
	const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
	const signed = Buffer.concat([Buffer.from(`${id}.${timestamp.trim()}.`, 'utf8'), body]);
	const expected = createHmac('sha256', key).update(signed).digest();

	for (const candidate of signatures.split(' ')) {
		const [version, value] = candidate.split(',', 2);
		if (version !== 'v1' || !value) continue;
		const given = Buffer.from(value, 'base64');
		if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
	}
	return { ok: false, reason: 'No signature matched the stored secret.' };
}

/** The HMAC key: the base64-decoded part of the secret after `whsec_`. */
export function secretKey(secret: string): Buffer | undefined {
	const trimmed = secret.trim();
	const encoded = trimmed.startsWith('whsec_') ? trimmed.slice('whsec_'.length) : trimmed;
	if (!encoded) return undefined;
	const key = Buffer.from(encoded, 'base64');
	return key.length ? key : undefined;
}
