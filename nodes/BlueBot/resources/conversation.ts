import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { blueBotApiRequest, blueBotApiRequestAllItems } from '../../shared/transport';
import type { ResourceDefinition } from './types';
import { itemsOf, listFields, listLimit, segment, showFor, stringParam } from './types';

const RESOURCE = 'conversation';

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{ name: 'Get', value: 'get', description: 'Get a conversation and its newest text', action: 'Get a conversation' },
			{ name: 'Get Many', value: 'getAll', description: 'Get many conversations, newest first, as the inbox shows them', action: 'Get many conversations' },
		],
		default: 'getAll',
	},
	{
		displayName: 'Conversation ID',
		name: 'conversationId',
		type: 'string',
		required: true,
		displayOptions: showFor(RESOURCE, ['get']),
		default: '',
		placeholder: 'conv_1Hq2LxW9cVbN3mKpRtYs0a',
		description: 'The conversation’s conv_ ID',
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
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Search names, numbers, group names and the words of texts',
			},
			{
				displayName: 'Show',
				name: 'filter',
				type: 'options',
				options: [
					{ name: 'All but Archived', value: 'all' },
					{ name: 'Archived', value: 'archived' },
					{ name: 'Unread', value: 'unread' },
					{ name: 'Waiting on You', value: 'waiting', description: 'The last text is theirs' },
				],
				default: 'all',
				description: 'Which conversations to show',
			},
		],
	},
];

async function get(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'conversationId', itemIndex);
	const conversation = await blueBotApiRequest.call(this, { method: 'GET', path: `/conversations/${segment(id)}`, itemIndex });
	return itemsOf(conversation, itemIndex);
}

async function getAll(this: IExecuteFunctions, itemIndex: number) {
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const qs: IDataObject = {};
	if (typeof filters.search === 'string' && filters.search.trim()) qs.q = filters.search.trim();
	if (typeof filters.filter === 'string' && filters.filter) qs.filter = filters.filter;
	const conversations = await blueBotApiRequestAllItems.call(this, { method: 'GET', path: '/conversations', qs, itemIndex }, listLimit.call(this, itemIndex));
	return itemsOf(conversations, itemIndex);
}

export const conversation: ResourceDefinition = {
	option: { name: 'Conversation', value: RESOURCE },
	properties,
	handlers: { get, getAll },
};
