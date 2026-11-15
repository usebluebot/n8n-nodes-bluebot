import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { DELIVERY_STATE_OPTIONS } from '../../shared/api.generated';
import { defaultIdempotencyKey } from '../../shared/idempotency';
import { blueBotApiRequest, blueBotApiRequestAllItems } from '../../shared/transport';
import type { ResourceDefinition } from './types';
import { itemsOf, listFields, listLimit, segment, showFor, stringParam } from './types';

const RESOURCE = 'webhookDelivery';

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{ name: 'Get Many', value: 'getAll', description: 'Get many deliveries of a webhook, newest first', action: 'Get many webhook deliveries' },
			{ name: 'Replay', value: 'replay', description: 'Send one delivery again', action: 'Replay a webhook delivery' },
		],
		default: 'getAll',
	},
	{
		displayName: 'Webhook ID',
		name: 'webhookId',
		type: 'string',
		required: true,
		displayOptions: showFor(RESOURCE, ['getAll', 'replay']),
		default: '',
		placeholder: 'wh_1Hq2LxW9cVbN3mKpRtYs0a',
		description: 'The webhook’s wh_ ID',
	},
	{
		displayName: 'Delivery ID',
		name: 'deliveryId',
		type: 'string',
		required: true,
		displayOptions: showFor(RESOURCE, ['replay']),
		default: '',
		placeholder: 'dlv_1Hq2LxW9cVbN3mKpRtYs0a',
		description: 'The delivery’s dlv_ ID',
	},
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
				displayName: 'State',
				name: 'state',
				type: 'options',
				options: DELIVERY_STATE_OPTIONS,
				default: 'pending',
				description: 'Only deliveries in this state',
			},
		],
	},
];

async function getAll(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'webhookId', itemIndex);
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const qs: IDataObject = {};
	if (typeof filters.state === 'string' && filters.state) qs.state = filters.state;
	const deliveries = await blueBotApiRequestAllItems.call(
		this,
		{ method: 'GET', path: `/webhooks/${segment(id)}/deliveries`, qs, itemIndex },
		listLimit.call(this, itemIndex),
	);
	return itemsOf(deliveries, itemIndex);
}

async function replay(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'webhookId', itemIndex);
	const deliveryId = stringParam.call(this, 'deliveryId', itemIndex);
	const delivery = await blueBotApiRequest.call(this, {
		method: 'POST',
		path: `/webhooks/${segment(id)}/deliveries/${segment(deliveryId)}/replay`,
		idempotencyKey: defaultIdempotencyKey.call(this, itemIndex),
		itemIndex,
	});
	return itemsOf(delivery, itemIndex);
}

export const webhookDelivery: ResourceDefinition = {
	option: { name: 'Webhook Delivery', value: RESOURCE },
	properties,
	handlers: { getAll, replay },
};
