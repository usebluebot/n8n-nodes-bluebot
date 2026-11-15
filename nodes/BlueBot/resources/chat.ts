import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { blueBotApiRequest, blueBotApiRequestAllItems } from '../../shared/transport';
import type { ResourceDefinition } from './types';
import { itemsOf, listFields, listLimit, segment, showFor, stringParam } from './types';

const RESOURCE = 'chat';

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{ name: 'Get', value: 'get', description: 'Get a chat', action: 'Get a chat' },
			{ name: 'Get Many', value: 'getAll', description: 'Get many chats, newest first', action: 'Get many chats' },
		],
		default: 'getAll',
	},
	{
		displayName: 'Chat ID',
		name: 'chatId',
		type: 'string',
		required: true,
		displayOptions: showFor(RESOURCE, ['get']),
		default: '',
		placeholder: 'chat_1Hq2LxW9cVbN3mKpRtYs0a',
		description: 'The chat’s chat_ ID',
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
				displayName: 'Is Group',
				name: 'isGroup',
				type: 'options',
				options: [
					{ name: 'Group Chats Only', value: 'true' },
					{ name: 'One-to-One Chats Only', value: 'false' },
				],
				default: 'true',
				description: 'Only group chats, or only one-to-one chats',
			},
			{
				displayName: 'Person',
				name: 'person',
				type: 'string',
				default: '',
				placeholder: '+15555550123',
				description: 'Only chats this person is in, by phone number or email address',
			},
		],
	},
];

async function get(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'chatId', itemIndex);
	const chat = await blueBotApiRequest.call(this, { method: 'GET', path: `/chats/${segment(id)}`, itemIndex });
	return itemsOf(chat, itemIndex);
}

async function getAll(this: IExecuteFunctions, itemIndex: number) {
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const qs: IDataObject = {};
	if (filters.isGroup === 'true' || filters.isGroup === 'false') qs.is_group = filters.isGroup;
	if (typeof filters.person === 'string' && filters.person.trim()) qs.person = filters.person.trim();
	const chats = await blueBotApiRequestAllItems.call(this, { method: 'GET', path: '/chats', qs, itemIndex }, listLimit.call(this, itemIndex));
	return itemsOf(chats, itemIndex);
}

export const chat: ResourceDefinition = {
	option: { name: 'Chat', value: RESOURCE },
	properties,
	handlers: { get, getAll },
};
