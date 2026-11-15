import { createHash } from 'crypto';

export interface FilePart {
	name: string;
	filename: string;
	contentType: string;
	data: Buffer;
}

export interface FieldPart {
	name: string;
	value: string;
}

/**
 * A `multipart/form-data` body built by hand, so the package needs no form library. The boundary comes from
 * `seed` (the call's idempotency key), so a retry sends the very same bytes and BlueBot replays the first answer
 * instead of refusing the key as used for a different request.
 */
export function multipartBody(parts: Array<FilePart | FieldPart>, seed: string): { body: Buffer; contentType: string } {
	const boundary = `n8nBlueBot${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
	const chunks: Buffer[] = [];
	for (const part of parts) {
		if ('data' in part) {
			chunks.push(
				Buffer.from(
					`--${boundary}\r\nContent-Disposition: form-data; name="${quote(part.name)}"; filename="${quote(part.filename)}"\r\nContent-Type: ${part.contentType}\r\n\r\n`,
					'utf8',
				),
			);
			chunks.push(part.data);
			chunks.push(Buffer.from('\r\n', 'utf8'));
		} else {
			chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(part.name)}"\r\n\r\n${part.value}\r\n`, 'utf8'));
		}
	}
	chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
	return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Quotes and line breaks can't appear inside a quoted header value. */
function quote(value: string): string {
	return value.replace(/[\r\n]+/g, ' ').replace(/"/g, '%22');
}
