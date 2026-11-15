import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { EVENT_OPTIONS } from '../../shared/api.generated';
import { toApiDateTime } from '../../shared/dates';
import { blueBotApiRequest, blueBotApiRequestAllItems } from '../../shared/transport';
import type { ResourceDefinition } from './types';
import { itemsOf, listFields, listLimit, segment, showFor, stringParam } from './types';

const RESOURCE = 'event';

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{ name: 'Get', value: 'get', description: 'Get an event', action: 'Get an event' },
			{ name: 'Get Many', value: 'getAll', description: 'Get many events from the last 30 days, newest first', action: 'Get many events' },
		],
		default: 'getAll',
	},
	{
		displayName: 'Event ID',
		name: 'eventId',
		type: 'string',
		required: true,
		displayOptions: showFor(RESOURCE, ['get']),
		default: '',
		placeholder: 'evt_1Hq2LxW9cVbN3mKpRtYs0a',
		description: 'The event’s evt_ ID',
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
				displayName: 'Since',
				name: 'since',
				type: 'dateTime',
				default: '',
				description: 'Only events at or after this time. Events are kept 30 days.',
			},
			{
				displayName: 'Types',
				name: 'types',
				type: 'multiOptions',
				options: EVENT_OPTIONS,
				default: [],
				description: 'Only events of these types',
			},
		],
	},
];

async function get(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'eventId', itemIndex);
	const event = await blueBotApiRequest.call(this, { method: 'GET', path: `/events/${segment(id)}`, itemIndex });
	return itemsOf(event, itemIndex);
}

async function getAll(this: IExecuteFunctions, itemIndex: number) {
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const qs: IDataObject = {};
	if (Array.isArray(filters.types) && filters.types.length) qs.type = (filters.types as string[]).join(',');
	const since = toApiDateTime(filters.since, this.getTimezone());
	if (since) qs.since = since;
	const events = await blueBotApiRequestAllItems.call(this, { method: 'GET', path: '/events', qs, itemIndex }, listLimit.call(this, itemIndex));
	return itemsOf(events, itemIndex);
}

export const event: ResourceDefinition = {
	option: { name: 'Event', value: RESOURCE },
	properties,
	handlers: { get, getAll },
};
