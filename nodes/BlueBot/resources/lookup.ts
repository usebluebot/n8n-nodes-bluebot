import type { IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { blueBotApiRequest } from '../../shared/transport';
import type { ResourceDefinition } from './types';
import { itemsOf, showFor, stringParam } from './types';

const RESOURCE = 'lookup';

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Check iMessage',
				value: 'checkIMessage',
				description: 'Check whether a person last used iMessage or SMS with you',
				action: 'Check which service a number uses',
			},
		],
		default: 'checkIMessage',
	},
	{
		displayName: 'Number',
		name: 'number',
		type: 'string',
		required: true,
		displayOptions: showFor(RESOURCE, ['checkIMessage']),
		default: '',
		placeholder: '+15555550123',
		description:
			'A phone number or email address. BlueBot reads your own Messages history through your Mac and waits up to 15 seconds; a number you’ve never texted is unknown.',
	},
];

async function checkIMessage(this: IExecuteFunctions, itemIndex: number) {
	const number = stringParam.call(this, 'number', itemIndex);
	const lookup = await blueBotApiRequest.call(this, { method: 'GET', path: '/lookup', qs: { number }, itemIndex });
	return itemsOf(lookup, itemIndex);
}

export const lookup: ResourceDefinition = {
	option: { name: 'Lookup', value: RESOURCE },
	properties,
	handlers: { checkIMessage },
};
