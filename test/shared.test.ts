import { describe, expect, it } from 'vitest';
import { toApiDateTime } from '../nodes/shared/dates';
import { derivedKey, fitKey } from '../nodes/shared/idempotency';
import { multipartBody } from '../nodes/shared/multipart';
import { TOLERANCE_SECONDS, secretKey, verifySignature } from '../nodes/shared/signature';
import { sign } from './helpers';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const OLD_SECRET = 'whsec_C2FVsBQIhrscChlQIMV+b5sSYspob7oD';
const NOW = 1_794_600_000;
const BODY = '{"id":"evt_1","type":"message.received","data":{"text":"Perfect, see you at 3"}}';

function headers(signature: string, timestamp = NOW, id = 'evt_1') {
	return { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': signature };
}

describe('verifySignature', () => {
	it('accepts the signature BlueBot makes over the raw body', () => {
		expect(verifySignature(Buffer.from(BODY), headers(sign(BODY, SECRET, 'evt_1', NOW)), SECRET, NOW)).toEqual({ ok: true });
		expect(verifySignature(BODY, headers(sign(BODY, SECRET, 'evt_1', NOW)), SECRET, NOW)).toEqual({ ok: true });
	});

	it('accepts either of the two signatures sent while a secret is rotated', () => {
		const both = `${sign(BODY, OLD_SECRET, 'evt_1', NOW)} ${sign(BODY, SECRET, 'evt_1', NOW)}`;
		expect(verifySignature(BODY, headers(both), SECRET, NOW)).toEqual({ ok: true });
		expect(verifySignature(BODY, headers(both), OLD_SECRET, NOW)).toEqual({ ok: true });
	});

	it('refuses a tampered body, a changed id and a signature made with another secret', () => {
		const signature = sign(BODY, SECRET, 'evt_1', NOW);
		expect(verifySignature(BODY.replace('3', '4'), headers(signature), SECRET, NOW).ok).toBe(false);
		expect(verifySignature(BODY, headers(signature, NOW, 'evt_2'), SECRET, NOW).ok).toBe(false);
		expect(verifySignature(BODY, headers(sign(BODY, OLD_SECRET, 'evt_1', NOW)), SECRET, NOW).ok).toBe(false);
	});

	it('refuses a body parsed and written out again, whose bytes differ', () => {
		const pretty = JSON.stringify(JSON.parse(BODY), null, 2);
		expect(verifySignature(pretty, headers(sign(BODY, SECRET, 'evt_1', NOW)), SECRET, NOW).ok).toBe(false);
	});

	it('takes a timestamp up to five minutes either way and refuses one beyond', () => {
		for (const offset of [-TOLERANCE_SECONDS, TOLERANCE_SECONDS]) {
			const sentAt = NOW + offset;
			expect(verifySignature(BODY, headers(sign(BODY, SECRET, 'evt_1', sentAt), sentAt), SECRET, NOW)).toEqual({ ok: true });
		}
		for (const offset of [-TOLERANCE_SECONDS - 1, TOLERANCE_SECONDS + 1]) {
			const sentAt = NOW + offset;
			expect(verifySignature(BODY, headers(sign(BODY, SECRET, 'evt_1', sentAt), sentAt), SECRET, NOW)).toEqual({
				ok: false,
				reason: 'The request is more than five minutes old or from the future.',
			});
		}
	});

	it('refuses missing headers, a timestamp that isn’t a number, other versions and a bad secret', () => {
		expect(verifySignature(BODY, {}, SECRET, NOW).ok).toBe(false);
		expect(verifySignature(BODY, headers(sign(BODY, SECRET, 'evt_1', NOW), Number.NaN), SECRET, NOW).ok).toBe(false);
		expect(verifySignature(BODY, headers(sign(BODY, SECRET, 'evt_1', NOW).replace('v1,', 'v2,')), SECRET, NOW).ok).toBe(false);
		expect(verifySignature(BODY, headers('v1,short'), SECRET, NOW).ok).toBe(false);
		expect(verifySignature(BODY, headers(sign(BODY, SECRET, 'evt_1', NOW)), 'whsec_', NOW)).toEqual({ ok: false, reason: 'The stored signing secret isn’t a whsec_ secret.' });
	});

	it('reads header names in either case and the first of repeated values', () => {
		const signature = sign(BODY, SECRET, 'evt_1', NOW);
		expect(verifySignature(BODY, { 'webhook-id': ['evt_1'], 'webhook-timestamp': [String(NOW)], 'webhook-signature': [signature] }, SECRET, NOW)).toEqual({ ok: true });
	});

	it('decodes the key from the part after whsec_', () => {
		expect(secretKey(SECRET)?.equals(Buffer.from('MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'base64'))).toBe(true);
	});
});

describe('toApiDateTime', () => {
	it('reads a date picker’s time with no zone in the workflow’s zone, through daylight saving', () => {
		expect(toApiDateTime('2026-11-14T15:00:00', 'America/Chicago')).toBe('2026-11-14T21:00:00.000Z');
		expect(toApiDateTime('2026-07-14T15:00:00', 'America/Chicago')).toBe('2026-07-14T20:00:00.000Z');
		expect(toApiDateTime('2026-11-14T15:00', 'Asia/Kolkata')).toBe('2026-11-14T09:30:00.000Z');
		expect(toApiDateTime('2026-11-14', 'UTC')).toBe('2026-11-14T00:00:00.000Z');
	});

	it('keeps an instant that already has a zone', () => {
		expect(toApiDateTime('2026-11-14T15:00:00-05:00', 'Asia/Tokyo')).toBe('2026-11-14T20:00:00.000Z');
		expect(toApiDateTime('2026-11-14T15:00:00Z', 'Asia/Tokyo')).toBe('2026-11-14T15:00:00.000Z');
		expect(toApiDateTime(new Date('2026-11-14T15:00:00Z'), 'Asia/Tokyo')).toBe('2026-11-14T15:00:00.000Z');
		expect(toApiDateTime({ toISO: () => '2026-11-14T09:00:00.000-06:00' }, 'UTC')).toBe('2026-11-14T15:00:00.000Z');
	});

	it('leaves empty values out and passes anything else on for BlueBot to judge', () => {
		expect(toApiDateTime('', 'UTC')).toBeUndefined();
		expect(toApiDateTime(undefined, 'UTC')).toBeUndefined();
		expect(toApiDateTime('next Tuesday', 'UTC')).toBe('next Tuesday');
	});
});

describe('idempotency keys', () => {
	it('keeps a key of up to 255 characters and hashes a longer one the same way every time', () => {
		expect(fitKey('n8n-exec-1-node-1-0')).toBe('n8n-exec-1-node-1-0');
		const long = 'k'.repeat(300);
		expect(fitKey(long)).toHaveLength(64);
		expect(fitKey(long)).toBe(fitKey(long));
		expect(derivedKey('n8n-exec-1-node-1-0', 'file0')).toBe('n8n-exec-1-node-1-0:file0');
		expect(derivedKey('k'.repeat(255), 'file0').length).toBeLessThanOrEqual(255);
	});
});

describe('multipartBody', () => {
	it('builds the same bytes for the same seed and keeps quotes and line breaks out of header values', () => {
		const parts = [
			{ name: 'file', filename: 'a "quoted"\r\nname.png', contentType: 'image/png', data: Buffer.from([0, 1, 2]) },
			{ name: 'name', value: 'Listing' },
		];
		const first = multipartBody(parts, 'seed-1');
		expect(multipartBody(parts, 'seed-1').body.equals(first.body)).toBe(true);
		expect(multipartBody(parts, 'seed-2').contentType).not.toBe(first.contentType);
		expect(first.body.toString('latin1')).toContain('filename="a %22quoted%22 name.png"');
	});
});
