import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { MESSAGE_SOURCE_OPTIONS, MESSAGE_STATE_OPTIONS } from '../../shared/api.generated';
import { toApiDateTime } from '../../shared/dates';
import { defaultIdempotencyKey, derivedKey } from '../../shared/idempotency';
import { blueBotApiRequest, blueBotApiRequestAllItems } from '../../shared/transport';
import { uploadBinary } from './file';
import type { ResourceDefinition } from './types';
import { itemsOf, listFields, listLimit, metadataField, metadataOf, segment, showFor, stringParam } from './types';

const RESOURCE = 'message';

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{ name: 'Cancel', value: 'cancel', description: 'Cancel a scheduled or queued text', action: 'Cancel a text' },
			{ name: 'Get', value: 'get', description: 'Get a text', action: 'Get a text' },
			{ name: 'Get Many', value: 'getAll', description: 'Get many texts, newest first', action: 'Get many texts' },
			{ name: 'Resolve', value: 'resolve', description: 'Settle an unconfirmed text', action: 'Resolve an unconfirmed text' },
			{ name: 'Send Text', value: 'sendText', description: 'Send a text, now or at a set time', action: 'Send a text' },
			{ name: 'Update', value: 'update', description: 'Change a scheduled text before it is due', action: 'Update a scheduled text' },
		],
		default: 'sendText',
	},

	// Send Text
	{
		displayName: 'Send To',
		name: 'sendTo',
		type: 'options',
		noDataExpression: true,
		displayOptions: showFor(RESOURCE, ['sendText']),
		options: [
			{ name: 'Group Chat', value: 'groupChat', description: 'An existing group chat' },
			{ name: 'Person', value: 'person', description: 'One person, by phone number or email address' },
		],
		default: 'person',
		description: 'Who gets the text',
	},
	{
		displayName: 'To',
		name: 'to',
		type: 'string',
		required: true,
		displayOptions: { show: { resource: [RESOURCE], operation: ['sendText'], sendTo: ['person'] } },
		default: '',
		placeholder: '+15555550123',
		description: 'A mobile number in any format (US numbers can leave off +1), or an email address the person uses for iMessage',
	},
	{
		displayName: 'Group Chat ID',
		name: 'chatId',
		type: 'string',
		required: true,
		displayOptions: { show: { resource: [RESOURCE], operation: ['sendText'], sendTo: ['groupChat'] } },
		default: '',
		placeholder: 'chat_1Hq2LxW9cVbN3mKpRtYs0a',
		description: 'A chat_ ID from Chat → Get Many. BlueBot can’t start a new group.',
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: {
			rows: 4,
		},
		displayOptions: showFor(RESOURCE, ['sendText']),
		default: '',
		description: 'The words, up to 2,000 characters. Leave it empty when files are added or a template is set.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(RESOURCE, ['sendText']),
		default: {},
		options: [
			{
				displayName: 'Expires At',
				name: 'expiresAt',
				type: 'dateTime',
				default: '',
				description: 'Give up if it is still waiting then. Default: 24 hours after it is due.',
			},
			{
				displayName: 'Files',
				name: 'files',
				type: 'fixedCollection',
				placeholder: 'Add Files',
				default: {},
				description: 'Up to 10 files, each up to 25 MB, sent after the words',
				options: [
					{
						displayName: 'Files',
						name: 'fileValues',
						values: [
							{
								displayName: 'Source',
								name: 'source',
								type: 'options',
								options: [
									{ name: 'Binary Properties', value: 'binaryProperties', description: 'Binary properties on the item, which the node uploads first' },
									{ name: 'File IDs', value: 'fileIds', description: 'File_ IDs from File → Upload' },
								],
								default: 'fileIds',
							},
							{
								displayName: 'File IDs',
								name: 'fileIds',
								type: 'string',
								displayOptions: { show: { source: ['fileIds'] } },
								default: '',
								placeholder: 'file_1Hq2LxW9cVbN3mKpRtYs0a, file_2Bf8QzD4kJmA6nXwEuTr1c',
								description: 'File_ IDs separated by commas',
							},
							{
								displayName: 'Binary Properties',
								name: 'binaryProperties',
								type: 'string',
								displayOptions: { show: { source: ['binaryProperties'] } },
								default: 'data',
								description: 'Names of binary properties on the item, separated by commas. Each is uploaded, then sent.',
							},
						],
					},
				],
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Leave empty for a key made from the execution, the node and the item, so Retry On Fail never sends a text twice. Set your own, such as the record’s ID, to make a send safe across executions.',
			},
			metadataField,
			{
				displayName: 'Send At',
				name: 'sendAt',
				type: 'dateTime',
				default: '',
				description: 'Schedule the text. It waits as scheduled and can be changed or canceled until then.',
			},
			{
				displayName: 'Service',
				name: 'service',
				type: 'options',
				options: [
					{ name: 'Auto', value: 'auto', description: 'What the newest chat with the person used, else iMessage, falling back to SMS once' },
					{ name: 'iMessage', value: 'imessage', description: 'Only iMessage, never SMS' },
					{ name: 'SMS', value: 'sms', description: 'A regular text through your iPhone (needs Text Message Forwarding)' },
				],
				default: 'auto',
			},
			{
				displayName: 'Template ID',
				name: 'templateId',
				type: 'string',
				default: '',
				placeholder: 'tpl_1Hq2LxW9cVbN3mKpRtYs0a',
				description: 'Send one of your templates instead of words, by its tpl_ ID from Template → Get Many. Leave Text empty.',
			},
			{
				displayName: 'Template Variables',
				name: 'variables',
				type: 'fixedCollection',
				placeholder: 'Add Variable',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				description:
					'A value for each {{name}} in the template. A variable you leave out comes from the contact or your business name, else from the template’s own fallback. One with none of those stops the send, naming it.',
				options: [
					{
						displayName: 'Variable',
						name: 'variableValues',
						values: [
							{
								displayName: 'Name',
								name: 'key',
								type: 'string',
								default: '',
								description: 'The variable’s name, without braces',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
		],
	},

	// Get, Cancel, Resolve, Update
	{
		displayName: 'Message ID',
		name: 'messageId',
		type: 'string',
		required: true,
		displayOptions: showFor(RESOURCE, ['get', 'cancel', 'resolve', 'update']),
		default: '',
		placeholder: 'msg_1Hq2LxW9cVbN3mKpRtYs0a',
		description: 'The text’s msg_ ID',
	},
	{
		displayName: 'Action',
		name: 'resolution',
		type: 'options',
		required: true,
		displayOptions: showFor(RESOURCE, ['resolve']),
		options: [
			{ name: 'Mark Sent', value: 'mark_sent', description: 'The person got it' },
			{ name: 'Send Again', value: 'send_again', description: 'Queue a new text with the same words, files and metadata' },
		],
		default: 'mark_sent',
		description: 'How to settle the unconfirmed text',
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(RESOURCE, ['update']),
		default: {},
		options: [
			{
				displayName: 'Expires At',
				name: 'expiresAt',
				type: 'dateTime',
				default: '',
				description: 'A new expiry',
			},
			{ ...metadataField, description: 'Replaces the text’s metadata whole' },
			{
				displayName: 'Send At',
				name: 'sendAt',
				type: 'dateTime',
				default: '',
				description: 'A new time to send it',
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				description: 'New words, up to 2,000 characters',
			},
		],
	},

	// Get Many
	...listFields(RESOURCE, 'getAll'),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		displayOptions: showFor(RESOURCE, ['getAll']),
		default: {},
		options: [
			{
				displayName: 'Chat ID',
				name: 'chatId',
				type: 'string',
				default: '',
				description: 'Only texts in this group chat',
			},
			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'string',
				default: '',
				description: 'Only texts with this contact',
			},
			{
				displayName: 'Created After',
				name: 'since',
				type: 'dateTime',
				default: '',
				description: 'Only texts created at or after this time',
			},
			{
				displayName: 'Created Before',
				name: 'until',
				type: 'dateTime',
				default: '',
				description: 'Only texts created before this time',
			},
			{
				displayName: 'Direction',
				name: 'direction',
				type: 'options',
				options: [
					{ name: 'In', value: 'in' },
					{ name: 'Out', value: 'out' },
				],
				default: 'in',
				description: 'Only texts in, or only texts out',
			},
			{
				displayName: 'Person',
				name: 'person',
				type: 'string',
				default: '',
				placeholder: '+15555550123',
				description: 'Only texts with this person, by phone number or email address',
			},
			{
				displayName: 'Source',
				name: 'source',
				type: 'options',
				options: MESSAGE_SOURCE_OPTIONS,
				default: 'api',
				description: 'Only texts from this source',
			},
			{
				displayName: 'State',
				name: 'state',
				type: 'options',
				options: MESSAGE_STATE_OPTIONS,
				default: 'queued',
				description: 'Only texts in this state',
			},
		],
	},
];

interface FilesField {
	fileValues?: { source?: string; fileIds?: string; binaryProperties?: string };
}

/** Template Variables as the API takes them; a variable with no value is left out, so BlueBot fills it in. */
function variablesOf(field: unknown): IDataObject | undefined {
	const pairs = (field as { variableValues?: Array<{ key?: unknown; value?: unknown }> } | undefined)?.variableValues;
	if (!Array.isArray(pairs)) return undefined;
	const variables: IDataObject = {};
	for (const pair of pairs) {
		const key = pair.key === undefined || pair.key === null ? '' : String(pair.key).trim().replace(/^\{\{\s*|\s*\}\}$/g, '');
		const value = pair.value === undefined || pair.value === null ? '' : String(pair.value);
		if (key && value) variables[key] = value;
	}
	return Object.keys(variables).length ? variables : undefined;
}

function list(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
}

async function sendText(this: IExecuteFunctions, itemIndex: number) {
	const sendTo = this.getNodeParameter('sendTo', itemIndex, 'person') as string;
	const text = this.getNodeParameter('text', itemIndex, '') as string;
	const fields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	const timeZone = this.getTimezone();
	const key = typeof fields.idempotencyKey === 'string' && fields.idempotencyKey.trim() ? fields.idempotencyKey.trim() : defaultIdempotencyKey.call(this, itemIndex);

	const body: IDataObject = {};
	if (sendTo === 'groupChat') body.chat_id = stringParam.call(this, 'chatId', itemIndex);
	else body.to = stringParam.call(this, 'to', itemIndex);
	if (text) body.text = text;

	const files = (fields.files as FilesField | undefined)?.fileValues;
	if (files) {
		if (files.source === 'binaryProperties') {
			const ids: string[] = [];
			const names = list(files.binaryProperties);
			for (let index = 0; index < names.length; index++) {
				const uploaded = await uploadBinary.call(this, itemIndex, names[index], undefined, derivedKey(key, `file${index}`));
				ids.push(String(uploaded.id));
			}
			if (ids.length) body.files = ids;
		} else {
			const ids = list(files.fileIds);
			if (ids.length) body.files = ids;
		}
	}
	if (typeof fields.service === 'string' && fields.service) body.service = fields.service;
	const sendAt = toApiDateTime(fields.sendAt, timeZone);
	if (sendAt) body.send_at = sendAt;
	const expiresAt = toApiDateTime(fields.expiresAt, timeZone);
	if (expiresAt) body.expires_at = expiresAt;
	const metadata = metadataOf(fields.metadata);
	if (metadata) body.metadata = metadata;
	if (typeof fields.templateId === 'string' && fields.templateId.trim()) {
		body.template_id = fields.templateId.trim();
		const variables = variablesOf(fields.variables);
		if (variables) body.variables = variables;
	}

	const message = await blueBotApiRequest.call(this, { method: 'POST', path: '/messages', body, idempotencyKey: key, itemIndex });
	return itemsOf(message, itemIndex);
}

async function get(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'messageId', itemIndex);
	const message = await blueBotApiRequest.call(this, { method: 'GET', path: `/messages/${segment(id)}`, itemIndex });
	return itemsOf(message, itemIndex);
}

async function getAll(this: IExecuteFunctions, itemIndex: number) {
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const timeZone = this.getTimezone();
	const qs: IDataObject = {};
	if (filters.direction) qs.direction = filters.direction;
	if (filters.state) qs.state = filters.state;
	if (typeof filters.person === 'string' && filters.person.trim()) qs.person = filters.person.trim();
	if (typeof filters.contactId === 'string' && filters.contactId.trim()) qs.contact_id = filters.contactId.trim();
	if (typeof filters.chatId === 'string' && filters.chatId.trim()) qs.chat_id = filters.chatId.trim();
	if (filters.source) qs.source = filters.source;
	const since = toApiDateTime(filters.since, timeZone);
	if (since) qs.since = since;
	const until = toApiDateTime(filters.until, timeZone);
	if (until) qs.until = until;
	const messages = await blueBotApiRequestAllItems.call(this, { method: 'GET', path: '/messages', qs, itemIndex }, listLimit.call(this, itemIndex));
	return itemsOf(messages, itemIndex);
}

async function update(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'messageId', itemIndex);
	const fields = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
	const timeZone = this.getTimezone();
	const body: IDataObject = {};
	if (typeof fields.text === 'string' && fields.text) body.text = fields.text;
	const sendAt = toApiDateTime(fields.sendAt, timeZone);
	if (sendAt) body.send_at = sendAt;
	const expiresAt = toApiDateTime(fields.expiresAt, timeZone);
	if (expiresAt) body.expires_at = expiresAt;
	if (fields.metadata !== undefined) body.metadata = metadataOf(fields.metadata) ?? {};
	const message = await blueBotApiRequest.call(this, { method: 'PATCH', path: `/messages/${segment(id)}`, body, itemIndex });
	return itemsOf(message, itemIndex);
}

async function cancel(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'messageId', itemIndex);
	const message = await blueBotApiRequest.call(this, {
		method: 'POST',
		path: `/messages/${segment(id)}/cancel`,
		idempotencyKey: defaultIdempotencyKey.call(this, itemIndex),
		itemIndex,
	});
	return itemsOf(message, itemIndex);
}

async function resolve(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'messageId', itemIndex);
	const action = this.getNodeParameter('resolution', itemIndex) as string;
	const message = await blueBotApiRequest.call(this, {
		method: 'POST',
		path: `/messages/${segment(id)}/resolve`,
		body: { action },
		idempotencyKey: defaultIdempotencyKey.call(this, itemIndex),
		itemIndex,
	});
	return itemsOf(message, itemIndex);
}

export const message: ResourceDefinition = {
	option: { name: 'Message', value: RESOURCE },
	properties,
	handlers: { sendText, get, getAll, update, cancel, resolve },
};
