import type { IDataObject } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlueBot } from '../nodes/BlueBot/BlueBot.node';
import { timing } from '../nodes/shared/transport';
import { EXAMPLES, page, responseOf } from './examples';
import { binaryOf, executeContext, type ExecuteOptions } from './helpers';

const node = new BlueBot();
const API = 'https://usebluebot.com/api/v1';
const KEY = 'n8n-exec-1-node-1-0';

beforeEach(() => {
	vi.spyOn(timing, 'wait').mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function run(options: ExecuteOptions) {
	const fake = executeContext(options);
	const output = await node.execute.call(fake.context);
	return { ...fake, output: output[0] };
}

interface Case {
	name: string;
	params: IDataObject;
	/** The API operation it calls, whose example answer the fake API gives. */
	operationId: string;
	method: string;
	url: string;
	qs?: IDataObject;
	body?: unknown;
	/** Whether the call carries the default idempotency key (every POST does). */
	keyed?: boolean;
}

const list = (resource: string, operation = 'getAll') => ({ resource, operation, returnAll: true });

const cases: Case[] = [
	{ name: 'Chat → Get', params: { resource: 'chat', operation: 'get', chatId: 'chat_1' }, operationId: 'getChat', method: 'GET', url: `${API}/chats/chat_1` },
	{
		name: 'Chat → Get Many',
		params: { ...list('chat'), filters: { isGroup: 'true', person: '+15555550123' } },
		operationId: 'listChats',
		method: 'GET',
		url: `${API}/chats`,
		qs: { is_group: 'true', person: '+15555550123', limit: 100 },
	},
	{
		name: 'Conversation → Get',
		params: { resource: 'conversation', operation: 'get', conversationId: 'conv_1' },
		operationId: 'getConversation',
		method: 'GET',
		url: `${API}/conversations/conv_1`,
	},
	{
		name: 'Conversation → Get Many',
		params: { ...list('conversation'), filters: { search: ' Maria ', filter: 'waiting' } },
		operationId: 'listConversations',
		method: 'GET',
		url: `${API}/conversations`,
		qs: { q: 'Maria', filter: 'waiting', limit: 100 },
	},
	{ name: 'Template → Get', params: { resource: 'template', operation: 'get', templateId: 'tpl_1' }, operationId: 'getTemplate', method: 'GET', url: `${API}/templates/tpl_1` },
	{
		name: 'Template → Get Many',
		params: { ...list('template'), filters: { search: 'showing' } },
		operationId: 'listTemplates',
		method: 'GET',
		url: `${API}/templates`,
		qs: { q: 'showing', limit: 100 },
	},
	{
		name: 'Lookup → Check iMessage',
		params: { resource: 'lookup', operation: 'checkIMessage', number: ' +15555550123 ' },
		operationId: 'lookupNumber',
		method: 'GET',
		url: `${API}/lookup`,
		qs: { number: '+15555550123' },
	},
	{ name: 'Device → Get Mac', params: { resource: 'device', operation: 'getMac' }, operationId: 'getDevice', method: 'GET', url: `${API}/device` },
	{ name: 'Device → Get BlueBot Status', params: { resource: 'device', operation: 'getStatus' }, operationId: 'getStatus', method: 'GET', url: `${API}/status` },
	{ name: 'Account → Get', params: { resource: 'account', operation: 'get' }, operationId: 'getMe', method: 'GET', url: `${API}/me` },
	{ name: 'Settings → Get', params: { resource: 'settings', operation: 'get' }, operationId: 'getSettings', method: 'GET', url: `${API}/settings` },
	{
		name: 'Settings → Update',
		params: {
			resource: 'settings',
			operation: 'update',
			updateFields: {
				timeZone: 'America/Chicago',
				paceSeconds: 45,
				newPeoplePerDay: 30,
				quietHoursEnabled: true,
				quietHoursStart: '21:00',
				quietHoursEnd: '08:00',
				smartQuietHours: false,
				stopWordsEnabled: true,
				expiryHours: 12,
				inboundMode: 'everything',
				pausedUntil: '2026-11-20T09:00:00',
			},
		},
		operationId: 'updateSettings',
		method: 'PATCH',
		url: `${API}/settings`,
		body: {
			time_zone: 'America/Chicago',
			pace_seconds: 45,
			new_people_per_day: 30,
			quiet_hours: { enabled: true, start: '21:00', end: '08:00' },
			smart_quiet_hours: false,
			stop_words: { enabled: true },
			expiry_hours: 12,
			inbound_mode: 'everything',
			paused_until: '2026-11-20T09:00:00.000Z',
		},
	},
	{
		name: 'Settings → Update (Resume Sending)',
		params: { resource: 'settings', operation: 'update', updateFields: { resumeSending: true, pausedUntil: '2026-11-20T09:00:00' } },
		operationId: 'updateSettings',
		method: 'PATCH',
		url: `${API}/settings`,
		body: { paused_until: null },
	},
	{ name: 'Stop → Add', params: { resource: 'stop', operation: 'add', person: '+15555550123' }, operationId: 'addStop', method: 'POST', url: `${API}/stops`, body: { person: '+15555550123' }, keyed: true },
	{ name: 'Stop → Get Many', params: list('stop'), operationId: 'listStops', method: 'GET', url: `${API}/stops`, qs: { limit: 100 } },
	{ name: 'Stop → Remove', params: { resource: 'stop', operation: 'remove', person: '+15555550123' }, operationId: 'removeStop', method: 'DELETE', url: `${API}/stops/%2B15555550123` },
	{ name: 'Event → Get', params: { resource: 'event', operation: 'get', eventId: 'evt_1' }, operationId: 'getEvent', method: 'GET', url: `${API}/events/evt_1` },
	{
		name: 'Event → Get Many',
		params: { ...list('event'), filters: { types: ['message.received', 'message.failed'], since: '2026-11-13T12:00:00Z' } },
		operationId: 'listEvents',
		method: 'GET',
		url: `${API}/events`,
		qs: { type: 'message.received,message.failed', since: '2026-11-13T12:00:00.000Z', limit: 100 },
	},
	{
		name: 'Webhook → Create',
		params: { resource: 'webhook', operation: 'create', url: 'https://example.com/hooks/bluebot', events: ['message.received'], additionalFields: { description: 'CRM replies' } },
		operationId: 'createWebhook',
		method: 'POST',
		url: `${API}/webhooks`,
		body: { url: 'https://example.com/hooks/bluebot', events: ['message.received'], description: 'CRM replies' },
		keyed: true,
	},
	{ name: 'Webhook → Get', params: { resource: 'webhook', operation: 'get', webhookId: 'wh_1' }, operationId: 'getWebhook', method: 'GET', url: `${API}/webhooks/wh_1` },
	{ name: 'Webhook → Get Many', params: list('webhook'), operationId: 'listWebhooks', method: 'GET', url: `${API}/webhooks`, qs: { limit: 100 } },
	{
		name: 'Webhook → Update',
		params: { resource: 'webhook', operation: 'update', webhookId: 'wh_1', updateFields: { url: 'https://example.com/new', events: ['*'], description: '', paused: true } },
		operationId: 'updateWebhook',
		method: 'PATCH',
		url: `${API}/webhooks/wh_1`,
		body: { url: 'https://example.com/new', events: ['*'], description: null, paused: true },
	},
	{ name: 'Webhook → Delete', params: { resource: 'webhook', operation: 'delete', webhookId: 'wh_1' }, operationId: 'deleteWebhook', method: 'DELETE', url: `${API}/webhooks/wh_1` },
	{
		name: 'Webhook → Send Test Event',
		params: { resource: 'webhook', operation: 'sendTest', webhookId: 'wh_1', eventType: 'message.failed' },
		operationId: 'testWebhook',
		method: 'POST',
		url: `${API}/webhooks/wh_1/test`,
		body: { type: 'message.failed' },
		keyed: true,
	},
	{
		name: 'Webhook → Rotate Secret',
		params: { resource: 'webhook', operation: 'rotateSecret', webhookId: 'wh_1' },
		operationId: 'rotateWebhookSecret',
		method: 'POST',
		url: `${API}/webhooks/wh_1/rotate-secret`,
		keyed: true,
	},
	{
		name: 'Webhook Delivery → Get Many',
		params: { ...list('webhookDelivery'), webhookId: 'wh_1', filters: { state: 'failed' } },
		operationId: 'listDeliveries',
		method: 'GET',
		url: `${API}/webhooks/wh_1/deliveries`,
		qs: { state: 'failed', limit: 100 },
	},
	{
		name: 'Webhook Delivery → Replay',
		params: { resource: 'webhookDelivery', operation: 'replay', webhookId: 'wh_1', deliveryId: 'dlv_1' },
		operationId: 'replayDelivery',
		method: 'POST',
		url: `${API}/webhooks/wh_1/deliveries/dlv_1/replay`,
		keyed: true,
	},
];

describe('each operation’s request', () => {
	it.each(cases)('$name', async (testCase) => {
		const example = responseOf(testCase.operationId);
		const isList = Array.isArray(example.data);
		const reply = isList ? { ...example, has_more: false, next_cursor: null } : example;
		const { calls, output } = await run({ timezone: 'UTC', params: testCase.params, replies: [{ status: EXAMPLES.operations[testCase.operationId].status, body: reply }] });

		expect(EXAMPLES.operations[testCase.operationId].method).toBe(testCase.method);
		expect(calls).toHaveLength(1);
		expect(calls[0].options.method).toBe(testCase.method);
		expect(calls[0].options.url).toBe(testCase.url);
		expect(calls[0].options.qs).toEqual(testCase.qs);
		expect(calls[0].options.body).toEqual(testCase.body);
		expect(calls[0].options.headers?.['BlueBot-Client']).toBe('n8n');
		expect(calls[0].options.headers?.['Idempotency-Key']).toBe(testCase.keyed ? KEY : undefined);
		const records = isList ? (example.data as IDataObject[]) : [example];
		expect(output).toEqual(records.map((json) => ({ json, pairedItem: { item: 0 } })));
	});

	it('Get Many with a limit pages through the API for each resource', async () => {
		const { calls, output } = await run({
			params: { resource: 'webhook', operation: 'getAll', returnAll: false, limit: 3 },
			replies: [{ body: page([{ id: 'wh_a' }, { id: 'wh_b' }], 'cur_2') }, { body: page([{ id: 'wh_c' }, { id: 'wh_d' }], null) }],
		});
		expect(calls.map((call) => call.options.qs)).toEqual([{ limit: 3 }, { limit: 1, cursor: 'cur_2' }]);
		expect(output.map((item) => item.json.id)).toEqual(['wh_a', 'wh_b', 'wh_c']);
	});
});

describe('File', () => {
	it('Upload posts the binary field as multipart with a name and a key', async () => {
		const bytes = Buffer.from('BEGIN:VCARD', 'utf8');
		const { calls, output } = await run({
			params: { resource: 'file', operation: 'upload', binaryPropertyName: 'card', additionalFields: { name: 'Maria Lopez.vcf' } },
			items: [{ json: {}, binary: { card: binaryOf(bytes, 'contact.vcf', 'text/vcard') } }],
			replies: [{ status: 201, body: responseOf('uploadFile') }],
		});
		expect(calls[0].options).toMatchObject({ method: 'POST', url: `${API}/files` });
		expect(calls[0].options.headers?.['Idempotency-Key']).toBe(KEY);
		const body = (calls[0].options.body as Buffer).toString('utf8');
		expect(body).toContain('name="file"; filename="contact.vcf"\r\nContent-Type: text/vcard\r\n\r\nBEGIN:VCARD\r\n');
		expect(body).toContain('Content-Disposition: form-data; name="name"\r\n\r\nMaria Lopez.vcf\r\n');
		expect(output[0].json).toEqual(responseOf('uploadFile'));
	});

	it('Upload says which binary field is missing', async () => {
		const error = await run({ params: { resource: 'file', operation: 'upload', binaryPropertyName: 'photo', additionalFields: {} } }).catch((e: unknown) => e);
		expect((error as Error).message).toContain('binary property "photo"');
	});

	it('Get answers the file without its bytes unless Download is on', async () => {
		const { calls, output, httpRequest } = await run({ params: { resource: 'file', operation: 'get', fileId: 'file_1', download: false }, replies: [{ body: responseOf('getFile') }] });
		expect(calls[0].options).toMatchObject({ method: 'GET', url: `${API}/files/file_1` });
		expect(httpRequest).not.toHaveBeenCalled();
		expect(output).toEqual([{ json: responseOf('getFile'), pairedItem: { item: 0 } }]);
	});

	it('Get with Download reads the signed link without the key and puts the bytes in the binary field', async () => {
		const file = responseOf('getFile');
		const { output, httpRequest } = await run({
			params: { resource: 'file', operation: 'get', fileId: 'file_1', download: true, binaryPropertyName: 'photo' },
			replies: [{ body: file }],
			download: Buffer.from('jpeg bytes'),
		});
		expect(httpRequest).toHaveBeenCalledTimes(1);
		const request = httpRequest.mock.calls[0][0];
		expect(request).toMatchObject({ method: 'GET', url: file.url, encoding: 'arraybuffer' });
		expect(request.headers).toEqual({ 'BlueBot-Client': 'n8n' });
		expect(output[0].json).toEqual(file);
		expect(output[0].binary?.photo).toEqual({ data: Buffer.from('jpeg bytes').toString('base64'), fileName: file.name, mimeType: file.content_type });
		expect(output[0].pairedItem).toEqual({ item: 0 });
	});
});
