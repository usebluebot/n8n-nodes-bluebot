import type { IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { blueBotApiRequest } from '../../shared/transport';
import type { ResourceDefinition } from './types';
import { itemsOf } from './types';

const RESOURCE = 'device';

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Get BlueBot Status',
				value: 'getStatus',
				description: 'Whether BlueBot itself is up and sending (needs no key)',
				action: 'Get the service status',
			},
			{
				name: 'Get Mac',
				value: 'getMac',
				description: 'Your Mac’s status, its checks, today’s counts and what is waiting',
				action: 'Get the device',
			},
		],
		default: 'getMac',
	},
];

async function getMac(this: IExecuteFunctions, itemIndex: number) {
	const device = await blueBotApiRequest.call(this, { method: 'GET', path: '/device', itemIndex });
	return itemsOf(device, itemIndex);
}

async function getStatus(this: IExecuteFunctions, itemIndex: number) {
	const status = await blueBotApiRequest.call(this, { method: 'GET', path: '/status', itemIndex });
	return itemsOf(status, itemIndex);
}

export const device: ResourceDefinition = {
	option: { name: 'Device', value: RESOURCE },
	properties,
	handlers: { getMac, getStatus },
};
