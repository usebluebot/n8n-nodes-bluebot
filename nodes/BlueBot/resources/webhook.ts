import type { IDataObject, IExecuteFunctions, INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { EVENT_OPTIONS } from '../../shared/api.generated';
import { defaultIdempotencyKey } from '../../shared/idempotency';
import { blueBotApiRequest, blueBotApiRequestAllItems } from '../../shared/transport';
import type { ResourceDefinition } from './types';
import { itemsOf, listFields, listLimit, segment, showFor, stringParam } from './types';

const RESOURCE = 'webhook';

/** The event types a webhook can take, with every type at once ("*") first. */
const WEBHOOK_EVENT_OPTIONS: INodePropertyOptions[] = [{ name: 'All Events', value: '*', description: 'Every event type, including ones added later' }, ...EVENT_OPTIONS];

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{ name: 'Create', value: 'create', description: 'Make a webhook. Its signing secret is shown only now.', action: 'Create a webhook' },
			{ name: 'Delete', value: 'delete', description: 'Delete a webhook', action: 'Delete a webhook' },
			{ name: 'Get', value: 'get', description: 'Get a webhook', action: 'Get a webhook' },
			{ name: 'Get Many', value: 'getAll', description: 'Get many webhooks', action: 'Get many webhooks' },
			{ name: 'Rotate Secret', value: 'rotateSecret', description: 'Make a new signing secret; the old one signs beside it for 24 hours', action: 'Rotate a webhook secret' },
			{ name: 'Send Test Event', value: 'sendTest', description: 'Send an example event to the webhook', action: 'Send a test event to a webhook' },
			{ name: 'Update', value: 'update', description: 'Change, pause or resume a webhook', action: 'Update a webhook' },
		],
		default: 'create',
	},

	// Create
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		required: true,
		displayOptions: showFor(RESOURCE, ['create']),
		default: '',
		placeholder: 'https://example.com/bluebot',
		description: 'A public https address. BlueBot doesn’t follow redirects.',
	},
	{
		displayName: 'Events',
		name: 'events',
		type: 'multiOptions',
		required: true,
		displayOptions: showFor(RESOURCE, ['create']),
		options: WEBHOOK_EVENT_OPTIONS,
		default: ['message.received'],
		description: 'The event types to send',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(RESOURCE, ['create']),
		default: {},
		options: [
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				description: 'What the webhook is for, up to 200 characters',
			},
		],
	},

	// Get, Update, Delete, Send Test Event, Rotate Secret
	{
		displayName: 'Webhook ID',
		name: 'webhookId',
		type: 'string',
		required: true,
		displayOptions: showFor(RESOURCE, ['get', 'update', 'delete', 'sendTest', 'rotateSecret']),
		default: '',
		placeholder: 'wh_1Hq2LxW9cVbN3mKpRtYs0a',
		description: 'The webhook’s wh_ ID',
	},
	{
		displayName: 'Event Type',
		name: 'eventType',
		type: 'options',
		displayOptions: showFor(RESOURCE, ['sendTest']),
		options: EVENT_OPTIONS,
		default: 'message.received',
		description: 'Which event to send an example of',
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
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				description: 'What the webhook is for, up to 200 characters',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: WEBHOOK_EVENT_OPTIONS,
				default: [],
				description: 'The event types to send',
			},
			{
				displayName: 'Paused',
				name: 'paused',
				type: 'boolean',
				default: false,
				description: 'Whether the webhook is paused. Resuming sends what waited from the last 72 hours.',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				description: 'A public https address',
			},
		],
	},

	// Get Many
	...listFields(RESOURCE, 'getAll'),
];

async function create(this: IExecuteFunctions, itemIndex: number) {
	const fields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	const body: IDataObject = {
		url: stringParam.call(this, 'url', itemIndex),
		events: this.getNodeParameter('events', itemIndex) as string[],
	};
	if (typeof fields.description === 'string' && fields.description.trim()) body.description = fields.description.trim();
	const webhook = await blueBotApiRequest.call(this, { method: 'POST', path: '/webhooks', body, idempotencyKey: defaultIdempotencyKey.call(this, itemIndex), itemIndex });
	return itemsOf(webhook, itemIndex);
}

async function get(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'webhookId', itemIndex);
	const webhook = await blueBotApiRequest.call(this, { method: 'GET', path: `/webhooks/${segment(id)}`, itemIndex });
	return itemsOf(webhook, itemIndex);
}

async function getAll(this: IExecuteFunctions, itemIndex: number) {
	const webhooks = await blueBotApiRequestAllItems.call(this, { method: 'GET', path: '/webhooks', itemIndex }, listLimit.call(this, itemIndex));
	return itemsOf(webhooks, itemIndex);
}

async function update(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'webhookId', itemIndex);
	const fields = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
	const body: IDataObject = {};
	if (typeof fields.url === 'string' && fields.url.trim()) body.url = fields.url.trim();
	if (Array.isArray(fields.events) && fields.events.length) body.events = fields.events;
	if (typeof fields.description === 'string') body.description = fields.description.trim() || null;
	if (typeof fields.paused === 'boolean') body.paused = fields.paused;
	const webhook = await blueBotApiRequest.call(this, { method: 'PATCH', path: `/webhooks/${segment(id)}`, body, itemIndex });
	return itemsOf(webhook, itemIndex);
}

async function remove(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'webhookId', itemIndex);
	const result = await blueBotApiRequest.call(this, { method: 'DELETE', path: `/webhooks/${segment(id)}`, itemIndex });
	return itemsOf(result, itemIndex);
}

async function sendTest(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'webhookId', itemIndex);
	const type = this.getNodeParameter('eventType', itemIndex, 'message.received') as string;
	const delivery = await blueBotApiRequest.call(this, {
		method: 'POST',
		path: `/webhooks/${segment(id)}/test`,
		body: { type },
		idempotencyKey: defaultIdempotencyKey.call(this, itemIndex),
		itemIndex,
	});
	return itemsOf(delivery, itemIndex);
}

async function rotateSecret(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'webhookId', itemIndex);
	const webhook = await blueBotApiRequest.call(this, {
		method: 'POST',
		path: `/webhooks/${segment(id)}/rotate-secret`,
		idempotencyKey: defaultIdempotencyKey.call(this, itemIndex),
		itemIndex,
	});
	return itemsOf(webhook, itemIndex);
}

export const webhook: ResourceDefinition = {
	option: { name: 'Webhook', value: RESOURCE },
	properties,
	handlers: { create, get, getAll, update, delete: remove, sendTest, rotateSecret },
};
