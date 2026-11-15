import type { IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { blueBotApiRequest } from '../../shared/transport';
import type { ResourceDefinition } from './types';
import { itemsOf } from './types';

const RESOURCE = 'account';

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get the account, the key in use, the plan and the Mac’s status',
				action: 'Get the account',
			},
		],
		default: 'get',
	},
];

async function get(this: IExecuteFunctions, itemIndex: number) {
	const me = await blueBotApiRequest.call(this, { method: 'GET', path: '/me', itemIndex });
	return itemsOf(me, itemIndex);
}

export const account: ResourceDefinition = {
	option: { name: 'Account', value: RESOURCE },
	properties,
	handlers: { get },
};
