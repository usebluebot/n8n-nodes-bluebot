import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { blueBotApiRequest, blueBotApiRequestAllItems } from '../../shared/transport';
import type { ResourceDefinition } from './types';
import { itemsOf, listFields, listLimit, segment, showFor, stringParam } from './types';

const RESOURCE = 'template';

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{ name: 'Get', value: 'get', description: 'Get a template with its words', action: 'Get a template' },
			{ name: 'Get Many', value: 'getAll', description: 'Get many templates, with the variables each one takes', action: 'Get many templates' },
		],
		default: 'getAll',
	},
	{
		displayName: 'Template ID',
		name: 'templateId',
		type: 'string',
		required: true,
		displayOptions: showFor(RESOURCE, ['get']),
		default: '',
		placeholder: 'tpl_1Hq2LxW9cVbN3mKpRtYs0a',
		description: 'The template’s tpl_ ID',
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
				description: 'Only templates whose name or words have this in them',
			},
		],
	},
];

async function get(this: IExecuteFunctions, itemIndex: number) {
	const id = stringParam.call(this, 'templateId', itemIndex);
	const template = await blueBotApiRequest.call(this, { method: 'GET', path: `/templates/${segment(id)}`, itemIndex });
	return itemsOf(template, itemIndex);
}

async function getAll(this: IExecuteFunctions, itemIndex: number) {
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const qs: IDataObject = {};
	if (typeof filters.search === 'string' && filters.search.trim()) qs.q = filters.search.trim();
	const templates = await blueBotApiRequestAllItems.call(this, { method: 'GET', path: '/templates', qs, itemIndex }, listLimit.call(this, itemIndex));
	return itemsOf(templates, itemIndex);
}

export const template: ResourceDefinition = {
	option: { name: 'Template', value: RESOURCE },
	properties,
	handlers: { get, getAll },
};
