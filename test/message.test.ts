import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlueBot } from '../nodes/BlueBot/BlueBot.node';
import { timing } from '../nodes/shared/transport';
import { page, responseOf } from './examples';
import { binaryOf, errorBody, executeContext, type ExecuteOptions } from './helpers';

const node = new BlueBot();

beforeEach(() => {
	vi.spyOn(timing, 'wait').mockResolvedValue(undefined);
	vi.spyOn(timing, 'random').mockReturnValue(0.5);
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function run(options: ExecuteOptions) {
	const fake = executeContext(options);
	const output = await node.execute.call(fake.context);
	return { ...fake, output: output[0] };
}

const send = { resource: 'message', operation: 'sendText', sendTo: 'person', to: '+15555550123', text: 'Hi Maria', additionalFields: {} };

describe('Message → Send Text', () => {
	it('posts the text with BlueBot-Client: n8n and a key made from the execution, node and item', async () => {
		const sent = responseOf('sendMessage');
		const { calls, output } = await run({ params: send, replies: [{ status: 201, body: sent }] });

		expect(calls).toHaveLength(1);
		expect(calls[0].options).toMatchObject({ method: 'POST', url: 'https://usebluebot.com/api/v1/messages', body: { to: '+15555550123', text: 'Hi Maria' } });
		expect(calls[0].options.headers).toMatchObject({ 'BlueBot-Client': 'n8n', 'Idempotency-Key': 'n8n-exec-1-node-1-0' });
		expect(output).toEqual([{ json: sent, pairedItem: { item: 0 } }]);
	});

	it('gives each item its own key and output', async () => {
		const { calls, output } = await run({
			params: [send, { ...send, to: '+15555550124' }],
			items: [{ json: {} }, { json: {} }],
			replies: [{ status: 201, body: { id: 'msg_a' } }, { status: 201, body: { id: 'msg_b' } }],
		});
		expect(calls.map((call) => call.options.headers?.['Idempotency-Key'])).toEqual(['n8n-exec-1-node-1-0', 'n8n-exec-1-node-1-1']);
		expect(calls.map((call) => (call.options.body as { to: string }).to)).toEqual(['+15555550123', '+15555550124']);
		expect(output).toEqual([
			{ json: { id: 'msg_a' }, pairedItem: { item: 0 } },
			{ json: { id: 'msg_b' }, pairedItem: { item: 1 } },
		]);
	});

	it('sends to a group chat by its ID', async () => {
		const { calls } = await run({
			params: { ...send, sendTo: 'groupChat', chatId: 'chat_1Hq2LxW9cVbN3mKpRtYs0a', to: undefined },
			replies: [{ status: 201, body: {} }],
		});
		expect(calls[0].options.body).toEqual({ chat_id: 'chat_1Hq2LxW9cVbN3mKpRtYs0a', text: 'Hi Maria' });
	});

	it('sends a template and its variables in place of words, leaving out a variable with no value', async () => {
		const { calls } = await run({
			params: {
				...send,
				text: '',
				additionalFields: {
					templateId: ' tpl_1Hq2LxW9cVbN3mKpRtYs0a ',
					variables: { variableValues: [{ key: 'showing', value: '412 Oak St' }, { key: '{{time}}', value: '3 PM' }, { key: 'blank', value: '' }] },
				},
			},
			replies: [{ status: 201, body: responseOf('sendMessage') }],
		});
		expect(calls[0].options.body).toEqual({ to: '+15555550123', template_id: 'tpl_1Hq2LxW9cVbN3mKpRtYs0a', variables: { showing: '412 Oak St', time: '3 PM' } });
	});

	it('sends no variables without a template', async () => {
		const { calls } = await run({
			params: { ...send, additionalFields: { variables: { variableValues: [{ key: 'showing', value: '412 Oak St' }] } } },
			replies: [{ status: 201, body: {} }],
		});
		expect(calls[0].options.body).toEqual({ to: '+15555550123', text: 'Hi Maria' });
	});

	it('sends every added field, reading a date with no zone in the workflow’s time zone', async () => {
		const { calls } = await run({
			timezone: 'America/Chicago',
			params: {
				...send,
				additionalFields: {
					service: 'sms',
					sendAt: '2026-11-14T15:00:00',
					expiresAt: '2026-11-15T09:00:00-05:00',
					metadata: { metadataValues: [{ key: 'crm_id', value: '8812' }, { key: ' ', value: 'dropped' }] },
					files: { fileValues: { source: 'fileIds', fileIds: 'file_1Hq2LxW9cVbN3mKpRtYs0a, file_2Bf8QzD4kJmA6nXwEuTr1c' } },
					idempotencyKey: ' crm-8812-reminder ',
				},
			},
			replies: [{ status: 201, body: {} }],
		});
		expect(calls[0].options.body).toEqual({
			to: '+15555550123',
			text: 'Hi Maria',
			files: ['file_1Hq2LxW9cVbN3mKpRtYs0a', 'file_2Bf8QzD4kJmA6nXwEuTr1c'],
			service: 'sms',
			send_at: '2026-11-14T21:00:00.000Z',
			expires_at: '2026-11-15T14:00:00.000Z',
			metadata: { crm_id: '8812' },
		});
		expect(calls[0].options.headers?.['Idempotency-Key']).toBe('crm-8812-reminder');
	});

	it('uploads binary properties first, each under a key of its own, then sends their file IDs', async () => {
		const photo = Buffer.from('a picture of 412 Oak St', 'utf8');
		const params = { ...send, text: '', additionalFields: { files: { fileValues: { source: 'binaryProperties', binaryProperties: 'data' } } } };
		const items = [{ json: {}, binary: { data: binaryOf(photo, 'listing.jpg', 'image/jpeg') } }];
		const replies = [
			{ status: 201, body: { ...responseOf('uploadFile'), id: 'file_up' } },
			{ status: 201, body: responseOf('sendMessage') },
		];

		const first = await run({ params, items, replies });
		const [upload, message] = first.calls;
		expect(upload.options.method).toBe('POST');
		expect(upload.options.url).toBe('https://usebluebot.com/api/v1/files');
		expect(upload.options.headers).toMatchObject({ 'BlueBot-Client': 'n8n', 'Idempotency-Key': 'n8n-exec-1-node-1-0:file0' });
		const contentType = String(upload.options.headers?.['Content-Type']);
		expect(contentType).toMatch(/^multipart\/form-data; boundary=n8nBlueBot[0-9a-f]{32}$/);
		const body = upload.options.body as Buffer;
		expect(Buffer.isBuffer(body)).toBe(true);
		expect(body.toString('utf8')).toContain('Content-Disposition: form-data; name="file"; filename="listing.jpg"\r\nContent-Type: image/jpeg\r\n\r\na picture of 412 Oak St\r\n');
		expect(body.toString('utf8')).toContain(`--${contentType.split('boundary=')[1]}--`);
		expect(message.options.body).toEqual({ to: '+15555550123', files: ['file_up'] });
		expect(message.options.headers?.['Idempotency-Key']).toBe('n8n-exec-1-node-1-0');

		// A retry of the same execution sends the very same bytes, so BlueBot replays its first answer.
		const again = await run({ params, items, replies });
		expect((again.calls[0].options.body as Buffer).equals(body)).toBe(true);
		expect(again.calls[0].options.headers).toEqual(upload.options.headers);
	});

	it('sends the same upload again after a 503, with the same key and bytes', async () => {
		const items = [{ json: {}, binary: { data: binaryOf(Buffer.from('pdf'), 'flyer.pdf', 'application/pdf') } }];
		const { calls } = await run({
			params: { ...send, additionalFields: { files: { fileValues: { source: 'binaryProperties', binaryProperties: 'data' } } } },
			items,
			replies: [
				{ status: 503, body: errorBody('unavailable', 'BlueBot is restarting.') },
				{ status: 201, body: { id: 'file_up' } },
				{ status: 201, body: { id: 'msg_1' } },
			],
		});
		expect(calls).toHaveLength(3);
		expect(calls[1].options).toEqual(calls[0].options);
	});

	it('passes on a held text as BlueBot accepted it', async () => {
		const held = { ...responseOf('sendMessage'), hold: { reason: 'quiet_hours', until: '2026-11-14T14:00:00.000Z' } };
		const { output } = await run({ params: send, replies: [{ status: 201, body: held }] });
		expect(output[0].json).toEqual(held);
	});
});

describe('Message → other operations', () => {
	it('Get reads one text by ID', async () => {
		const { calls, output } = await run({ params: { resource: 'message', operation: 'get', messageId: 'msg_1Hq2LxW9cVbN3mKpRtYs0a' }, replies: [{ body: responseOf('getMessage') }] });
		expect(calls[0].options).toMatchObject({ method: 'GET', url: 'https://usebluebot.com/api/v1/messages/msg_1Hq2LxW9cVbN3mKpRtYs0a' });
		expect(calls[0].options.headers?.['Idempotency-Key']).toBeUndefined();
		expect(output[0].json).toEqual(responseOf('getMessage'));
	});

	it('Get Many sends the filters and puts each text on its own item', async () => {
		const { calls, output } = await run({
			timezone: 'UTC',
			params: {
				resource: 'message',
				operation: 'getAll',
				returnAll: false,
				limit: 2,
				filters: { direction: 'in', state: 'received', person: ' +15555550123 ', contactId: 'ct_1', chatId: 'chat_1', source: 'api', since: '2026-11-01T00:00:00', until: '2026-11-13T00:00:00Z' },
			},
			replies: [{ body: page([{ id: 'msg_a' }, { id: 'msg_b' }], 'cur_2') }],
		});
		expect(calls[0].options).toMatchObject({ method: 'GET', url: 'https://usebluebot.com/api/v1/messages' });
		expect(calls[0].options.qs).toEqual({
			direction: 'in',
			state: 'received',
			person: '+15555550123',
			contact_id: 'ct_1',
			chat_id: 'chat_1',
			source: 'api',
			since: '2026-11-01T00:00:00.000Z',
			until: '2026-11-13T00:00:00.000Z',
			limit: 2,
		});
		expect(output).toEqual([
			{ json: { id: 'msg_a' }, pairedItem: { item: 0 } },
			{ json: { id: 'msg_b' }, pairedItem: { item: 0 } },
		]);
	});

	it('Update sends only the fields set, and metadata whole', async () => {
		const { calls } = await run({
			timezone: 'UTC',
			params: { resource: 'message', operation: 'update', messageId: 'msg_1', updateFields: { text: 'New words', sendAt: '2026-11-14T16:00:00', metadata: { metadataValues: [{ key: 'crm_id', value: '9' }] } } },
			replies: [{ body: {} }],
		});
		expect(calls[0].options).toMatchObject({ method: 'PATCH', url: 'https://usebluebot.com/api/v1/messages/msg_1' });
		expect(calls[0].options.body).toEqual({ text: 'New words', send_at: '2026-11-14T16:00:00.000Z', metadata: { crm_id: '9' } });
	});

	it('Cancel posts to the text’s cancel address with a key', async () => {
		const { calls } = await run({ params: { resource: 'message', operation: 'cancel', messageId: 'msg_1' }, replies: [{ body: responseOf('cancelMessage') }] });
		expect(calls[0].options).toMatchObject({ method: 'POST', url: 'https://usebluebot.com/api/v1/messages/msg_1/cancel' });
		expect(calls[0].options.body).toBeUndefined();
		expect(calls[0].options.headers?.['Idempotency-Key']).toBe('n8n-exec-1-node-1-0');
	});

	it('Resolve sends the chosen resolution as action', async () => {
		const { calls } = await run({ params: { resource: 'message', operation: 'resolve', messageId: 'msg_1', resolution: 'send_again' }, replies: [{ body: {} }] });
		expect(calls[0].options).toMatchObject({ method: 'POST', url: 'https://usebluebot.com/api/v1/messages/msg_1/resolve', body: { action: 'send_again' } });
		expect(calls[0].options.headers?.['Idempotency-Key']).toBe('n8n-exec-1-node-1-0');
	});
});

describe('errors', () => {
	const refused = { status: 400, body: errorBody('invalid_request', 'to is not a phone number or email address.') };

	it('throws BlueBot’s message as a NodeApiError for the item', async () => {
		const error = await run({ params: send, replies: [refused] }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeApiError);
		expect((error as NodeApiError).message).toBe('to is not a phone number or email address.');
		expect((error as NodeApiError).description).toBe('Check the fields named in the message and send it again. (invalid_request, req_1Hq2LxW9cVbN3mKpRtYs0a)');
		expect((error as NodeApiError).context.itemIndex).toBe(0);
	});

	it('puts the error on the item and goes on when the node continues on fail', async () => {
		const { output } = await run({
			continueOnFail: true,
			params: [send, send],
			items: [{ json: {} }, { json: {} }],
			replies: [refused, { status: 201, body: { id: 'msg_b' } }],
		});
		expect(output).toEqual([
			{
				json: {
					error: 'to is not a phone number or email address.',
					code: 'invalid_request',
					status: 400,
					hint: 'Check the fields named in the message and send it again.',
					request_id: 'req_1Hq2LxW9cVbN3mKpRtYs0a',
					doc_url: 'https://usebluebot.com/docs/errors/invalid_request',
				},
				pairedItem: { item: 0 },
			},
			{ json: { id: 'msg_b' }, pairedItem: { item: 1 } },
		]);
	});

	it('says so for an operation the resource doesn’t have', async () => {
		const error = await run({ params: { resource: 'message', operation: 'explode' } }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeOperationError);
		expect((error as Error).message).toBe('BlueBot has no operation "explode" for the resource "message".');
	});
});
