import { NodeApiError } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	BlueBotApiError,
	backoffMs,
	blueBotApiRequest,
	blueBotApiRequestAllItems,
	failureItem,
	parseRetryAfter,
	readFailure,
	timing,
} from '../nodes/shared/transport';
import { page, responseOf } from './examples';
import { errorBody, executeContext } from './helpers';

let waits: number[];

beforeEach(() => {
	waits = [];
	vi.spyOn(timing, 'wait').mockImplementation(async (ms: number) => {
		waits.push(ms);
	});
	// The middle of the jitter, so a backoff is exactly its base.
	vi.spyOn(timing, 'random').mockReturnValue(0.5);
});

afterEach(() => {
	vi.restoreAllMocks();
});

function context(replies: Parameters<typeof executeContext>[0]['replies'], credentials?: Record<string, string>) {
	return executeContext({ params: {}, replies, credentials });
}

describe('blueBotApiRequest', () => {
	it('sends the key through the credential, BlueBot-Client: n8n and the idempotency key', async () => {
		const { context: ctx, calls } = context([{ status: 201, body: responseOf('sendMessage') }]);
		const answer = await blueBotApiRequest.call(ctx, { method: 'POST', path: '/messages', body: { to: '+15555550123', text: 'Hi' }, idempotencyKey: 'key-1' });

		expect(answer).toEqual(responseOf('sendMessage'));
		expect(calls).toHaveLength(1);
		expect(calls[0].credentialType).toBe('blueBotApi');
		expect(calls[0].options).toMatchObject({
			method: 'POST',
			url: 'https://usebluebot.com/api/v1/messages',
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
			body: { to: '+15555550123', text: 'Hi' },
		});
		expect(calls[0].options.headers).toEqual({ Accept: 'application/json', 'BlueBot-Client': 'n8n', 'Idempotency-Key': 'key-1' });
		expect(calls[0].options.qs).toBeUndefined();
	});

	it('uses the credential’s Base URL without its trailing slash, and the default when it is blank', async () => {
		const custom = context([{ body: {} }], { apiKey: 'bb_test_abc', baseUrl: 'https://staging.example.com/api/v1/ ' });
		await blueBotApiRequest.call(custom.context, { method: 'GET', path: '/me' });
		expect(custom.calls[0].options.url).toBe('https://staging.example.com/api/v1/me');

		const blank = context([{ body: {} }], { apiKey: 'bb_test_abc', baseUrl: '' });
		await blueBotApiRequest.call(blank.context, { method: 'GET', path: '/me' });
		expect(blank.calls[0].options.url).toBe('https://usebluebot.com/api/v1/me');
	});

	it('leaves out an empty query and sends a filled one', async () => {
		const { context: ctx, calls } = context([{ body: {} }, { body: {} }]);
		await blueBotApiRequest.call(ctx, { method: 'GET', path: '/lookup', qs: {} });
		await blueBotApiRequest.call(ctx, { method: 'GET', path: '/lookup', qs: { number: '+15555550123' } });
		expect(calls[0].options.qs).toBeUndefined();
		expect(calls[1].options.qs).toEqual({ number: '+15555550123' });
	});

	it('reads a body that came back as JSON text', async () => {
		const { context: ctx } = context([{ body: '{"ok":true}' }]);
		expect(await blueBotApiRequest.call(ctx, { method: 'GET', path: '/status' })).toEqual({ ok: true });
	});

	it('turns BlueBot’s error into a NodeApiError with its message, hint, code and request id, and doesn’t retry a 400', async () => {
		const { context: ctx, calls } = context([
			{
				status: 400,
				body: errorBody('invalid_request', 'to is not a phone number or email address.', { details: [{ field: 'to', message: 'Not a phone number or email address.' }] }),
			},
		]);
		const error = await blueBotApiRequest.call(ctx, { method: 'POST', path: '/messages', body: {}, idempotencyKey: 'k', itemIndex: 3 }).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(BlueBotApiError);
		expect(error).toBeInstanceOf(NodeApiError);
		const apiError = error as BlueBotApiError;
		expect(apiError.message).toBe('to is not a phone number or email address.');
		expect(apiError.description).toBe('Check the fields named in the message and send it again. (invalid_request, req_1Hq2LxW9cVbN3mKpRtYs0a)');
		expect(apiError.httpCode).toBe('400');
		expect(apiError.context).toMatchObject({ code: 'invalid_request', status: 400, request_id: 'req_1Hq2LxW9cVbN3mKpRtYs0a', itemIndex: 3 });
		expect(apiError.failure.details).toEqual([{ field: 'to', message: 'Not a phone number or email address.' }]);
		expect(calls).toHaveLength(1);
		expect(waits).toEqual([]);
	});

	it('waits the Retry-After seconds on a 429 and sends the same request with the same key', async () => {
		const { context: ctx, calls } = context([
			{ status: 429, headers: { 'retry-after': '2' }, body: errorBody('rate_limited', 'This key made too many requests.') },
			{ status: 201, body: responseOf('sendMessage') },
		]);
		const answer = await blueBotApiRequest.call(ctx, { method: 'POST', path: '/messages', body: { to: '+15555550123', text: 'Hi' }, idempotencyKey: 'key-9' });

		expect(answer.id).toBe(responseOf('sendMessage').id);
		expect(waits).toEqual([2000]);
		expect(calls).toHaveLength(2);
		expect(calls[1].options).toEqual(calls[0].options);
		expect(calls[1].options.headers?.['Idempotency-Key']).toBe('key-9');
	});

	it('waits the body’s retry_after when there is no Retry-After header', async () => {
		const { context: ctx } = context([
			{ status: 429, body: errorBody('rate_limited', 'Slow down.', { retry_after: 3 }) },
			{ status: 200, body: { ok: true } },
		]);
		await blueBotApiRequest.call(ctx, { method: 'GET', path: '/status' });
		expect(waits).toEqual([3000]);
	});

	it('fails at once when BlueBot asks for a wait over 60 seconds', async () => {
		const { context: ctx, calls } = context([{ status: 429, headers: { 'Retry-After': '120' }, body: errorBody('rate_limited', 'Daily limit reached.') }]);
		const error = (await blueBotApiRequest.call(ctx, { method: 'GET', path: '/status' }).catch((e: unknown) => e)) as BlueBotApiError;
		expect(error).toBeInstanceOf(BlueBotApiError);
		expect(error.failure.retryAfter).toBe(120);
		expect(calls).toHaveLength(1);
		expect(waits).toEqual([]);
	});

	it('backs off on a 5xx with no Retry-After, then gives up after two retries', async () => {
		const unavailable = { status: 503, body: errorBody('unavailable', 'BlueBot is restarting.') };
		const { context: ctx, calls } = context([unavailable, unavailable, unavailable]);
		const error = (await blueBotApiRequest.call(ctx, { method: 'GET', path: '/status' }).catch((e: unknown) => e)) as BlueBotApiError;
		expect(error).toBeInstanceOf(BlueBotApiError);
		expect(error.failure.code).toBe('unavailable');
		expect(calls).toHaveLength(3);
		expect(waits).toEqual([500, 1000]);
	});

	it('retries a 409 only when it asks for a wait', async () => {
		const busy = context([
			{ status: 409, headers: { 'Retry-After': '1' }, body: errorBody('conflict', 'A request with this key is still running.') },
			{ status: 201, body: { id: 'msg_1' } },
		]);
		await blueBotApiRequest.call(busy.context, { method: 'POST', path: '/messages', body: {}, idempotencyKey: 'k' });
		expect(busy.calls).toHaveLength(2);
		expect(waits).toEqual([1000]);

		const used = context([{ status: 409, body: errorBody('conflict', 'This key was used for a different request.') }]);
		await expect(blueBotApiRequest.call(used.context, { method: 'POST', path: '/messages', body: {}, idempotencyKey: 'k' })).rejects.toBeInstanceOf(BlueBotApiError);
		expect(used.calls).toHaveLength(1);
	});

	it('retries a dropped connection, but never a DELETE', async () => {
		const reset = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
		const get = context([reset, { body: { ok: true } }]);
		expect(await blueBotApiRequest.call(get.context, { method: 'GET', path: '/status' })).toEqual({ ok: true });
		expect(get.calls).toHaveLength(2);
		expect(waits).toEqual([500]);

		const remove = context([reset]);
		const error = await blueBotApiRequest.call(remove.context, { method: 'DELETE', path: '/webhooks/wh_1' }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error).not.toBeInstanceOf(BlueBotApiError);
		expect(remove.calls).toHaveLength(1);
	});

	it('gives an answer with no error body a plain message, a code from its status and the Request-Id header', async () => {
		const { context: ctx } = context([
			{ status: 502, headers: { 'Request-Id': 'req_proxy' }, body: '<html>Bad gateway</html>' },
			{ status: 502, body: '<html>Bad gateway</html>' },
			{ status: 502, body: '<html>Bad gateway</html>' },
		]);
		const error = (await blueBotApiRequest.call(ctx, { method: 'GET', path: '/status' }).catch((e: unknown) => e)) as BlueBotApiError;
		expect(error.message).toBe('BlueBot answered with HTTP 502 and no error message.');
		expect(error.failure.code).toBe('upstream_failed');
	});
});

describe('blueBotApiRequestAllItems', () => {
	const a = { id: 'msg_a' };
	const b = { id: 'msg_b' };
	const c = { id: 'msg_c' };

	it('follows next_cursor to the end for Return All, 100 a page', async () => {
		const { context: ctx, calls } = context([{ body: page([a, b], 'cur_2') }, { body: page([c], null) }]);
		const all = await blueBotApiRequestAllItems.call(ctx, { method: 'GET', path: '/messages', qs: { direction: 'in' } });
		expect(all).toEqual([a, b, c]);
		expect(calls.map((call) => call.options.qs)).toEqual([
			{ direction: 'in', limit: 100 },
			{ direction: 'in', limit: 100, cursor: 'cur_2' },
		]);
	});

	it('asks only for what the limit still needs and stops there', async () => {
		const { context: ctx, calls } = context([{ body: page([a, b], 'cur_2') }, { body: page([c], 'cur_3') }]);
		const some = await blueBotApiRequestAllItems.call(ctx, { method: 'GET', path: '/messages' }, 3);
		expect(some).toEqual([a, b, c]);
		expect(calls.map((call) => call.options.qs)).toEqual([{ limit: 3 }, { limit: 1, cursor: 'cur_2' }]);
	});

	it('takes the example list answer as one page', async () => {
		const list = responseOf('listMessages');
		const { context: ctx, calls } = context([{ body: { ...list, has_more: false, next_cursor: null } }]);
		const all = await blueBotApiRequestAllItems.call(ctx, { method: 'GET', path: '/messages' });
		expect(all).toEqual(list.data);
		expect(calls).toHaveLength(1);
	});
});

describe('helpers', () => {
	it('reads Retry-After as seconds or as an HTTP date', () => {
		expect(parseRetryAfter('5')).toBe(5);
		expect(parseRetryAfter(undefined)).toBeUndefined();
		expect(parseRetryAfter('soon')).toBeUndefined();
		const inTen = new Date(Date.now() + 10_000).toUTCString();
		const seconds = parseRetryAfter(inTen) ?? -1;
		expect(seconds).toBeGreaterThanOrEqual(9);
		expect(seconds).toBeLessThanOrEqual(11);
	});

	it('backs off 500, 1000, then 2000 ms, jittered by a fifth either way', () => {
		vi.spyOn(timing, 'random').mockReturnValue(0);
		expect([0, 1, 2, 3].map(backoffMs)).toEqual([400, 800, 1600, 1600]);
		vi.spyOn(timing, 'random').mockReturnValue(1);
		expect([0, 1, 2].map(backoffMs)).toEqual([600, 1200, 2400]);
	});

	it('reads the request id from the body before the header', () => {
		const failure = readFailure(404, { 'request-id': 'req_header' }, errorBody('not_found', 'No such text.'));
		expect(failure).toMatchObject({ status: 404, code: 'not_found', message: 'No such text.', requestId: 'req_1Hq2LxW9cVbN3mKpRtYs0a' });
	});

	it('puts BlueBot’s error fields on a continue-on-fail item', () => {
		const ctx = context([]).context;
		const error = new BlueBotApiError(ctx.getNode(), readFailure(402, undefined, errorBody('plan_lapsed', 'Your plan has lapsed.')), 0);
		expect(failureItem(error)).toEqual({
			error: 'Your plan has lapsed.',
			code: 'plan_lapsed',
			status: 402,
			hint: 'Check the fields named in the message and send it again.',
			request_id: 'req_1Hq2LxW9cVbN3mKpRtYs0a',
			doc_url: 'https://usebluebot.com/docs/errors/plan_lapsed',
		});
		expect(failureItem(new Error('Something else'))).toEqual({ error: 'Something else' });
	});
});
