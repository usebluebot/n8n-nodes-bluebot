import type { IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { defaultIdempotencyKey } from '../../shared/idempotency';
import { blueBotApiRequest, blueBotApiRequestAllItems } from '../../shared/transport';
import type { ResourceDefinition } from './types';
import { itemsOf, listFields, listLimit, segment, showFor, stringParam } from './types';

const RESOURCE = 'stop';

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{ name: 'Add', value: 'add', description: 'Put a person on your stop list', action: 'Add a person to the stop list' },
			{ name: 'Get Many', value: 'getAll', description: 'Get many people on your stop list', action: 'Get many stops' },
			{ name: 'Remove', value: 'remove', description: 'Take a person off your stop list', action: 'Remove a person from the stop list' },
		],
		default: 'add',
	},
	{
		displayName: 'Person',
		name: 'person',
		type: 'string',
		required: true,
		displayOptions: showFor(RESOURCE, ['add', 'remove']),
		default: '',
		placeholder: '+15555550123',
		description: 'A phone number or email address',
	},
	...listFields(RESOURCE, 'getAll'),
];

async function add(this: IExecuteFunctions, itemIndex: number) {
	const person = stringParam.call(this, 'person', itemIndex);
	const stop = await blueBotApiRequest.call(this, {
		method: 'POST',
		path: '/stops',
		body: { person },
		idempotencyKey: defaultIdempotencyKey.call(this, itemIndex),
		itemIndex,
	});
	return itemsOf(stop, itemIndex);
}

async function getAll(this: IExecuteFunctions, itemIndex: number) {
	const stops = await blueBotApiRequestAllItems.call(this, { method: 'GET', path: '/stops', itemIndex }, listLimit.call(this, itemIndex));
	return itemsOf(stops, itemIndex);
}

async function remove(this: IExecuteFunctions, itemIndex: number) {
	const person = stringParam.call(this, 'person', itemIndex);
	const result = await blueBotApiRequest.call(this, { method: 'DELETE', path: `/stops/${segment(person)}`, itemIndex });
	return itemsOf(result, itemIndex);
}

export const stop: ResourceDefinition = {
	option: { name: 'Stop', value: RESOURCE },
	properties,
	handlers: { add, getAll, remove },
};
