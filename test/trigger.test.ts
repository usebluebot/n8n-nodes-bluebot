import type { IDataObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlueBotTrigger } from '../nodes/BlueBotTrigger/BlueBotTrigger.node';
import { EVENT_TYPES } from '../nodes/shared/api.generated';
import { timing } from '../nodes/shared/transport';
import { eventOf, page, responseOf } from './examples';
import { errorBody, hookContext, sign, webhookContext } from './helpers';

const trigger = new BlueBotTrigger();
const hooks = trigger.webhookMethods.default;
const API = 'https://usebluebot.com/api/v1';
const URL_HERE = 'https://n8n.example.com/webhook/abc/webhook';
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const OLD_SECRET = 'whsec_C2FVsBQIhrscChlQIMV+b5sSYspob7oD';

beforeEach(() => {
	vi.spyOn(timing, 'wait').mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

function webhook(overrides: IDataObject = {}): IDataObject {
	return { ...responseOf('getWebhook'), id: 'wh_1', url: URL_HERE, events: ['message.received'], status: 'active', pause_reason: null, ...overrides };
}

describe('description', () => {
	it('offers every event type BlueBot sends and starts on Message Received', () => {
		const events = trigger.description.properties.find((property) => property.name === 'events');
		expect(events?.options?.map((option) => ('value' in option ? option.value : undefined)).sort()).toEqual([...EVENT_TYPES].sort());
		expect(events?.default).toEqual(['message.received']);
		const output = trigger.description.properties.find((property) => property.name === 'output');
		expect(output?.options?.map((option) => ('value' in option ? option.value : undefined))).toEqual(['record', 'event']);
	});
});

describe('create', () => {
	it('makes a webhook to this node’s URL for the chosen events and keeps its id and secret', async () => {
		const made = responseOf('createWebhook');
		const { context, calls, staticData } = hookContext({
			params: { events: ['message.received', 'message.failed'] },
			replies: [{ body: page([], null) }, { status: 201, body: { ...made, id: 'wh_new', url: URL_HERE, secret: SECRET } }],
		});

		expect(await hooks.create.call(context)).toBe(true);
		expect(calls[0].options).toMatchObject({ method: 'GET', url: `${API}/webhooks`, qs: { limit: 100 } });
		expect(calls[1].options).toMatchObject({
			method: 'POST',
			url: `${API}/webhooks`,
			body: { url: URL_HERE, events: ['message.received', 'message.failed'], description: 'n8n: Replies to reminders' },
		});
		expect(calls[1].options.headers?.['BlueBot-Client']).toBe('n8n');
		expect(String(calls[1].options.headers?.['Idempotency-Key'])).toMatch(/^n8n-trigger-[0-9a-f-]{36}$/);
		expect(staticData).toEqual({ webhookId: 'wh_new', webhookSecret: SECRET });
	});

	it('first deletes a webhook left at this same address by an earlier activation', async () => {
		const { context, calls } = hookContext({
			replies: [
				{ body: page([webhook({ id: 'wh_old' }), webhook({ id: 'wh_other', url: 'https://example.com/elsewhere' })], null) },
				{ body: { id: 'wh_old', object: 'webhook', deleted: true } },
				{ status: 201, body: { id: 'wh_new', secret: SECRET } },
			],
		});
		await hooks.create.call(context);
		expect(calls.map((call) => `${call.options.method} ${call.options.url}`)).toEqual([`GET ${API}/webhooks`, `DELETE ${API}/webhooks/wh_old`, `POST ${API}/webhooks`]);
	});

	it('cuts the description at 200 characters', async () => {
		const { context, calls } = hookContext({ workflowName: 'x'.repeat(300), replies: [{ body: page([], null) }, { status: 201, body: { id: 'wh_new', secret: SECRET } }] });
		await hooks.create.call(context);
		expect((calls[1].options.body as IDataObject).description).toHaveLength(200);
	});

	it('says how to set WEBHOOK_URL when BlueBot refuses n8n’s address', async () => {
		const { context, staticData } = hookContext({
			webhookUrl: 'http://localhost:5678/webhook/abc/webhook',
			replies: [
				{ body: page([], null) },
				{
					status: 400,
					body: errorBody('invalid_request', 'url must be a public https address.', { details: [{ field: 'url', message: 'Must be a public https address.' }] }),
				},
			],
		});
		const error = (await hooks.create.call(context).catch((e: unknown) => e)) as NodeApiError;
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('BlueBot couldn’t reach this URL');
		expect(error.description).toBe(
			'url must be a public https address. n8n gave BlueBot http://localhost:5678/webhook/abc/webhook. Set WEBHOOK_URL to n8n’s public https address, restart n8n and try again. (invalid_request, req_1Hq2LxW9cVbN3mKpRtYs0a)',
		);
		expect(error.httpCode).toBe('400');
		expect(staticData).toEqual({});
	});

	it('passes any other refusal on with BlueBot’s message', async () => {
		const { context } = hookContext({ replies: [{ body: page([], null) }, { status: 403, body: errorBody('forbidden', 'This key doesn’t have the webhooks:manage scope.') }] });
		const error = (await hooks.create.call(context).catch((e: unknown) => e)) as NodeApiError;
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('This key doesn’t have the webhooks:manage scope.');
	});

	it('refuses an answer with no signing secret rather than keep a webhook it can’t check', async () => {
		const { context, staticData } = hookContext({ replies: [{ body: page([], null) }, { status: 201, body: { id: 'wh_new' } }] });
		await expect(hooks.create.call(context)).rejects.toBeInstanceOf(NodeApiError);
		expect(staticData).toEqual({});
	});
});

describe('checkExists', () => {
	it('is false with nothing stored, without asking BlueBot', async () => {
		const { context, calls } = hookContext();
		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(calls).toHaveLength(0);
	});

	it('is true when the stored webhook points here and listens for the chosen events', async () => {
		const { context, calls } = hookContext({
			params: { events: ['message.failed', 'message.received'] },
			staticData: { webhookId: 'wh_1', webhookSecret: SECRET },
			replies: [{ body: webhook({ events: ['message.received', 'message.failed'] }) }],
		});
		expect(await hooks.checkExists.call(context)).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0].options).toMatchObject({ method: 'GET', url: `${API}/webhooks/wh_1` });
	});

	it('forgets a webhook that is gone', async () => {
		const { context, staticData } = hookContext({
			staticData: { webhookId: 'wh_1', webhookSecret: SECRET },
			replies: [{ status: 404, body: errorBody('not_found', 'No such webhook.') }],
		});
		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(staticData).toEqual({});
	});

	it('replaces a webhook whose events no longer match', async () => {
		const { context, calls, staticData } = hookContext({
			params: { events: ['message.received', 'contact.opted_out'] },
			staticData: { webhookId: 'wh_1', webhookSecret: SECRET },
			replies: [{ body: webhook() }, { body: { id: 'wh_1', deleted: true } }],
		});
		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(calls[1].options).toMatchObject({ method: 'DELETE', url: `${API}/webhooks/wh_1` });
		expect(staticData).toEqual({});
	});

	it('turns delivery back on for a webhook BlueBot paused after failures', async () => {
		const { context, calls } = hookContext({
			staticData: { webhookId: 'wh_1', webhookSecret: SECRET },
			replies: [{ body: webhook({ status: 'paused', pause_reason: 'failing' }) }, { body: webhook() }],
		});
		expect(await hooks.checkExists.call(context)).toBe(true);
		expect(calls[1].options).toMatchObject({ method: 'PATCH', url: `${API}/webhooks/wh_1`, body: { paused: false } });
	});

	it('leaves alone a webhook the customer paused', async () => {
		const { context, calls } = hookContext({
			staticData: { webhookId: 'wh_1', webhookSecret: SECRET },
			replies: [{ body: webhook({ status: 'paused', pause_reason: 'customer' }) }],
		});
		expect(await hooks.checkExists.call(context)).toBe(true);
		expect(calls).toHaveLength(1);
	});

	it('throws on a failure other than not found', async () => {
		const unavailable = { status: 503, body: errorBody('unavailable', 'BlueBot is restarting.') };
		const { context } = hookContext({ staticData: { webhookId: 'wh_1', webhookSecret: SECRET }, replies: [unavailable, unavailable, unavailable] });
		await expect(hooks.checkExists.call(context)).rejects.toBeInstanceOf(NodeApiError);
	});
});

describe('delete', () => {
	it('deletes the stored webhook and forgets it', async () => {
		const { context, calls, staticData } = hookContext({ staticData: { webhookId: 'wh_1', webhookSecret: SECRET }, replies: [{ body: { id: 'wh_1', deleted: true } }] });
		expect(await hooks.delete.call(context)).toBe(true);
		expect(calls[0].options).toMatchObject({ method: 'DELETE', url: `${API}/webhooks/wh_1` });
		expect(calls[0].options.headers?.['BlueBot-Client']).toBe('n8n');
		expect(staticData).toEqual({});
	});

	it('counts a webhook already gone as deleted', async () => {
		const { context, staticData } = hookContext({ staticData: { webhookId: 'wh_1', webhookSecret: SECRET }, replies: [{ status: 404, body: errorBody('not_found', 'No such webhook.') }] });
		expect(await hooks.delete.call(context)).toBe(true);
		expect(staticData).toEqual({});
	});

	it('has nothing to do when nothing is stored', async () => {
		const { context, calls } = hookContext();
		expect(await hooks.delete.call(context)).toBe(true);
		expect(calls).toHaveLength(0);
	});
});

describe('webhook', () => {
	const now = () => Math.floor(Date.now() / 1000);
	const event = eventOf('message.received');
	const raw = Buffer.from(JSON.stringify(event), 'utf8');

	function deliver(options: { body?: Buffer; headers?: Record<string, string>; params?: IDataObject; secret?: string | null }) {
		const body = options.body ?? raw;
		const staticData: IDataObject = options.secret === null ? {} : { webhookId: 'wh_1', webhookSecret: options.secret ?? SECRET };
		const timestamp = now();
		const headers = options.headers ?? { 'webhook-id': 'evt_1', 'webhook-timestamp': String(timestamp), 'webhook-signature': sign(body, SECRET, 'evt_1', timestamp) };
		return webhookContext({ rawBody: body, headers, params: options.params, staticData });
	}

	it('starts the workflow with the event’s record', async () => {
		const { context, response } = deliver({});
		const result = await trigger.webhook.call(context);
		expect(result.workflowData).toEqual([[{ json: event.data }]]);
		expect(response.statusCode).toBe(200);
	});

	it('starts the workflow with the whole event when Output is Whole Event', async () => {
		const { context } = deliver({ params: { events: ['message.received'], output: 'event' } });
		const result = await trigger.webhook.call(context);
		expect(result.workflowData).toEqual([[{ json: event }]]);
	});

	it('accepts a delivery signed with both secrets while one is being rotated', async () => {
		const timestamp = now();
		const signature = `${sign(raw, OLD_SECRET, 'evt_1', timestamp)} ${sign(raw, SECRET, 'evt_1', timestamp)}`;
		const { context } = deliver({ headers: { 'webhook-id': 'evt_1', 'webhook-timestamp': String(timestamp), 'webhook-signature': signature } });
		expect((await trigger.webhook.call(context)).workflowData).toHaveLength(1);
	});

	it('answers 401 and starts nothing for a tampered body', async () => {
		const timestamp = now();
		const tampered = Buffer.from(JSON.stringify({ ...event, data: { ...(event.data as IDataObject), text: 'Something else' } }), 'utf8');
		const { context, response } = deliver({
			body: tampered,
			headers: { 'webhook-id': 'evt_1', 'webhook-timestamp': String(timestamp), 'webhook-signature': sign(raw, SECRET, 'evt_1', timestamp) },
		});
		const result = await trigger.webhook.call(context);
		expect(result).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(401);
		expect(response.body).toEqual({ error: 'The webhook signature didn’t match.' });
	});

	it('answers 401 for a delivery more than five minutes old, though its signature is right', async () => {
		const timestamp = now() - 301;
		const { context, response } = deliver({ headers: { 'webhook-id': 'evt_1', 'webhook-timestamp': String(timestamp), 'webhook-signature': sign(raw, SECRET, 'evt_1', timestamp) } });
		expect(await trigger.webhook.call(context)).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(401);
	});

	it('answers 401 for a delivery signed with another secret, or with none stored', async () => {
		const wrong = deliver({ secret: OLD_SECRET });
		expect(await trigger.webhook.call(wrong.context)).toEqual({ noWebhookResponse: true });
		expect(wrong.response.statusCode).toBe(401);

		const none = deliver({ secret: null });
		expect(await trigger.webhook.call(none.context)).toEqual({ noWebhookResponse: true });
		expect(none.response.statusCode).toBe(401);
	});

	it('answers 401 when the signature headers are missing', async () => {
		const { context, response } = deliver({ headers: {} });
		expect(await trigger.webhook.call(context)).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(401);
	});

	it('reads the raw body when n8n hasn’t yet', async () => {
		const { context, request } = deliver({});
		const body = request.rawBody;
		request.rawBody = undefined;
		request.readRawBody.mockImplementation(async () => {
			request.rawBody = body;
		});
		expect((await trigger.webhook.call(context)).workflowData).toHaveLength(1);
		expect(request.readRawBody).toHaveBeenCalledTimes(1);
	});

	it('acknowledges an event type this trigger doesn’t listen for without starting the workflow', async () => {
		const { context, response } = deliver({ body: Buffer.from(JSON.stringify(eventOf('message.failed')), 'utf8') });
		expect(await trigger.webhook.call(context)).toEqual({ webhookResponse: { received: true } });
		expect(response.statusCode).toBe(200);
	});

	it('answers 400 for a signed body that isn’t JSON', async () => {
		const notJson = Buffer.from('not json', 'utf8');
		const timestamp = now();
		const { context, response } = webhookContext({
			rawBody: notJson,
			headers: { 'webhook-id': 'evt_3', 'webhook-timestamp': String(timestamp), 'webhook-signature': sign(notJson, SECRET, 'evt_3', timestamp) },
			staticData: { webhookId: 'wh_1', webhookSecret: SECRET },
		});
		expect(await trigger.webhook.call(context)).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(400);
	});
});
