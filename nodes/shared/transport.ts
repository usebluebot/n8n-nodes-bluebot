import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';

export const CREDENTIAL_NAME = 'blueBotApi';
export const DEFAULT_BASE_URL = 'https://usebluebot.com/api/v1';

/** Sets `source: "n8n"` on every text the node sends. */
export const CLIENT_HEADER = 'BlueBot-Client';
export const CLIENT_NAME = 'n8n';

/** Tries after the first for a 429, a 5xx, a 409 that asks for a wait, or a dropped connection. */
export const MAX_RETRIES = 2;

/** BlueBot asking for a longer wait than this fails the call at once rather than holding the workflow. */
export const MAX_WAIT_SECONDS = 60;

const BACKOFF_MS = [500, 1000, 2000];
const MAX_BACKOFF_MS = 8000;

const TRANSIENT_CODES = new Set([
	'ECONNRESET',
	'ECONNREFUSED',
	'ECONNABORTED',
	'ETIMEDOUT',
	'ESOCKETTIMEDOUT',
	'EPIPE',
	'EAI_AGAIN',
	'ENETUNREACH',
	'EHOSTUNREACH',
	'UND_ERR_SOCKET',
	'UND_ERR_CONNECT_TIMEOUT',
]);

export type BlueBotContext = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

export interface BlueBotRequest {
	method: IHttpRequestMethods;
	/** The path after the base URL, such as `/messages`. */
	path: string;
	qs?: IDataObject;
	body?: IDataObject | Buffer;
	headers?: IDataObject;
	/** Sent as `Idempotency-Key`. Every POST carries one. */
	idempotencyKey?: string;
	/** The input item the call is for, so an error points at it. */
	itemIndex?: number;
}

/** What BlueBot said when a call failed: the `error` object of its answer, plus the HTTP status. */
export interface BlueBotFailure {
	status: number;
	code: string;
	message: string;
	hint?: string;
	docUrl?: string;
	requestId?: string;
	details?: Array<{ field: string; message: string }>;
	/** Seconds to wait before trying again, from `Retry-After` or `retry_after`. */
	retryAfter?: number;
}

/** Waiting goes through here so tests can skip the wait and see how long it would have been. */
export const timing = {
	wait: async (ms: number): Promise<void> => {
		await sleep(ms);
	},
	random: (): number => Math.random(),
};

/** A refusal from BlueBot, shown with its message, its hint and its code and request id. */
export class BlueBotApiError extends NodeApiError {
	readonly failure: BlueBotFailure;

	constructor(node: INode, failure: BlueBotFailure, itemIndex?: number) {
		super(node, failureResponse(failure), {
			message: failure.message,
			description: describeFailure(failure),
			httpCode: String(failure.status),
			itemIndex,
		});
		this.failure = failure;
		this.context.code = failure.code;
		this.context.status = failure.status;
		if (failure.requestId) this.context.request_id = failure.requestId;
	}
}

/** BlueBot's error as the JSON an n8n error carries in its details. */
export function failureResponse(failure: BlueBotFailure): JsonObject {
	const response: JsonObject = { code: failure.code, status: failure.status, message: failure.message };
	if (failure.hint) response.hint = failure.hint;
	if (failure.docUrl) response.doc_url = failure.docUrl;
	if (failure.requestId) response.request_id = failure.requestId;
	if (failure.details) response.details = failure.details;
	if (failure.retryAfter !== undefined) response.retry_after = failure.retryAfter;
	return response;
}

/** The hint, then the code and request id: "Check the fields named in the message and send it again. (invalid_request, req_…)". */
export function describeFailure(failure: BlueBotFailure): string {
	const reference = [failure.code, failure.requestId].filter(Boolean).join(', ');
	return [failure.hint, reference ? `(${reference})` : ''].filter(Boolean).join(' ');
}

/** The item a failed call leaves behind when the node continues on fail. */
export function failureItem(error: unknown): IDataObject {
	if (error instanceof BlueBotApiError) {
		const { failure } = error;
		const json: IDataObject = { error: failure.message, code: failure.code, status: failure.status };
		if (failure.hint) json.hint = failure.hint;
		if (failure.requestId) json.request_id = failure.requestId;
		if (failure.docUrl) json.doc_url = failure.docUrl;
		if (failure.details) json.details = failure.details;
		return json;
	}
	const json: IDataObject = { error: error instanceof Error ? error.message : String(error) };
	const description = (error as { description?: unknown } | null)?.description;
	if (typeof description === 'string' && description) json.description = description;
	return json;
}

export async function baseUrl(this: BlueBotContext): Promise<string> {
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	const configured = typeof credentials.baseUrl === 'string' ? credentials.baseUrl.trim() : '';
	return (configured || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/**
 * One call to the BlueBot API with the credential's key, `BlueBot-Client: n8n` and, for a POST, the
 * `Idempotency-Key`. A 429, a 5xx, a 409 that asks for a wait and a dropped connection are tried again up to
 * twice with the same key, after the wait BlueBot asks for (at most 60 seconds) or a short backoff. Any other
 * failure, or one that is still failing, throws a `BlueBotApiError` carrying BlueBot's message and hint.
 */
export async function blueBotApiRequest(this: BlueBotContext, request: BlueBotRequest): Promise<IDataObject> {
	const root = await baseUrl.call(this);
	const headers: IDataObject = { Accept: 'application/json', [CLIENT_HEADER]: CLIENT_NAME, ...request.headers };
	if (request.idempotencyKey) headers['Idempotency-Key'] = request.idempotencyKey;
	const options: IHttpRequestOptions = {
		method: request.method,
		url: `${root}${request.path}`,
		headers,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (request.qs && Object.keys(request.qs).length) options.qs = request.qs;
	if (request.body !== undefined) options.body = request.body;

	for (let attempt = 0; ; attempt++) {
		let response: { statusCode: number; headers?: IDataObject; body?: unknown };
		try {
			response = await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_NAME, options);
		} catch (error) {
			if (attempt < MAX_RETRIES && request.method !== 'DELETE' && isConnectionError(error)) {
				await timing.wait(backoffMs(attempt));
				continue;
			}
			throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: request.itemIndex });
		}

		const status = Number(response.statusCode);
		if (status >= 200 && status < 300) return asObject(response.body);

		const failure = readFailure(status, response.headers, response.body);
		if (attempt < MAX_RETRIES && retryable(failure)) {
			if (failure.retryAfter !== undefined && failure.retryAfter > MAX_WAIT_SECONDS) {
				throw new BlueBotApiError(this.getNode(), failure, request.itemIndex);
			}
			await timing.wait(failure.retryAfter !== undefined && failure.retryAfter > 0 ? failure.retryAfter * 1000 : backoffMs(attempt));
			continue;
		}
		throw new BlueBotApiError(this.getNode(), failure, request.itemIndex);
	}
}

/**
 * Every item of a list, following `next_cursor`, or the first `limit` of them. Pages are as large as the API
 * allows (100) so that Return All takes as few calls as it can.
 */
export async function blueBotApiRequestAllItems(this: BlueBotContext, request: BlueBotRequest, limit?: number): Promise<IDataObject[]> {
	const results: IDataObject[] = [];
	let cursor: string | undefined;
	do {
		const pageSize = limit === undefined ? 100 : Math.max(1, Math.min(100, limit - results.length));
		const qs: IDataObject = { ...request.qs, limit: pageSize };
		if (cursor) qs.cursor = cursor;
		const page = await blueBotApiRequest.call(this, { ...request, qs });
		const data = Array.isArray(page.data) ? (page.data as IDataObject[]) : [];
		results.push(...data);
		cursor = page.has_more === true && typeof page.next_cursor === 'string' && page.next_cursor ? page.next_cursor : undefined;
	} while (cursor && (limit === undefined || results.length < limit));
	return limit === undefined ? results : results.slice(0, limit);
}

function retryable(failure: BlueBotFailure): boolean {
	if (failure.status === 429 || failure.status >= 500) return true;
	return failure.status === 409 && failure.retryAfter !== undefined;
}

export function backoffMs(attempt: number): number {
	const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
	const jittered = base * (0.8 + 0.4 * timing.random());
	return Math.min(MAX_BACKOFF_MS, Math.round(jittered));
}

function isConnectionError(error: unknown): boolean {
	const candidates: unknown[] = [];
	let current: unknown = error;
	for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
		candidates.push(current);
		const next = current as { cause?: unknown; errorResponse?: unknown };
		current = next.cause ?? next.errorResponse;
	}
	return candidates.some((candidate) => {
		const code = (candidate as { code?: unknown }).code;
		return typeof code === 'string' && TRANSIENT_CODES.has(code);
	});
}

function asObject(body: unknown): IDataObject {
	if (body && typeof body === 'object' && !Array.isArray(body)) return body as IDataObject;
	if (typeof body === 'string' && body.trim()) {
		try {
			const parsed: unknown = JSON.parse(body);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as IDataObject;
		} catch {
			// A body that isn't JSON is passed on as text below.
		}
		return { body };
	}
	return {};
}

function header(headers: IDataObject | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() !== wanted) continue;
		if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
		return value === undefined || value === null ? undefined : String(value);
	}
	return undefined;
}

/** `Retry-After` in seconds, or as an HTTP date. */
export function parseRetryAfter(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
	const date = Date.parse(trimmed);
	if (Number.isNaN(date)) return undefined;
	return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

const FALLBACK_CODES: Record<number, string> = {
	400: 'invalid_request',
	401: 'unauthorized',
	402: 'plan_lapsed',
	403: 'forbidden',
	404: 'not_found',
	409: 'conflict',
	413: 'payload_too_large',
	415: 'unsupported_media_type',
	429: 'rate_limited',
	500: 'internal',
	502: 'upstream_failed',
	503: 'unavailable',
};

/** Reads BlueBot's error body; an answer without one (a proxy's page, say) gets a plain message of its own. */
export function readFailure(status: number, headers: IDataObject | undefined, body: unknown): BlueBotFailure {
	const parsed = asObject(body);
	const envelope = parsed.error && typeof parsed.error === 'object' ? (parsed.error as IDataObject) : undefined;
	const failure: BlueBotFailure = {
		status,
		code: typeof envelope?.code === 'string' ? envelope.code : (FALLBACK_CODES[status] ?? (status >= 500 ? 'internal' : 'invalid_request')),
		message: typeof envelope?.message === 'string' && envelope.message ? envelope.message : `BlueBot answered with HTTP ${status} and no error message.`,
	};
	if (typeof envelope?.hint === 'string' && envelope.hint) failure.hint = envelope.hint;
	if (typeof envelope?.doc_url === 'string' && envelope.doc_url) failure.docUrl = envelope.doc_url;
	const requestId = typeof envelope?.request_id === 'string' && envelope.request_id ? envelope.request_id : header(headers, 'request-id');
	if (requestId) failure.requestId = requestId;
	if (Array.isArray(envelope?.details)) failure.details = envelope.details as Array<{ field: string; message: string }>;
	const retryAfter = parseRetryAfter(header(headers, 'retry-after')) ?? (typeof envelope?.retry_after === 'number' ? envelope.retry_after : undefined);
	if (retryAfter !== undefined) failure.retryAfter = retryAfter;
	return failure;
}
