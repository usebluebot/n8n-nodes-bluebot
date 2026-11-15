import type { IExecuteFunctions, INodeExecutionData, INodeProperties, INodeType, INodeTypeDescription, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { failureItem } from '../shared/transport';
import { RESOURCES } from './resources';
import type { OperationHandler } from './resources/types';

const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: RESOURCES.map((resource) => resource.option),
	default: 'message',
};

const HANDLERS: Record<string, Record<string, OperationHandler>> = Object.fromEntries(RESOURCES.map((resource) => [resource.option.value, resource.handlers]));

export class BlueBot implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'BlueBot',
		name: 'blueBot',
		icon: { light: 'file:../../icons/bluebot.svg', dark: 'file:../../icons/bluebot.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send and read texts from your own number through the Messages app on your Mac',
		defaults: {
			name: 'BlueBot',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'blueBotApi',
				required: true,
			},
		],
		properties: [resourceProperty, ...RESOURCES.flatMap((resource) => resource.properties)],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const handler = HANDLERS[resource]?.[operation];
				if (!handler) {
					throw new NodeOperationError(this.getNode(), `BlueBot has no operation "${operation}" for the resource "${resource}".`, { itemIndex });
				}
				returnData.push(...(await handler.call(this, itemIndex)));
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: failureItem(error), pairedItem: { item: itemIndex } });
					continue;
				}
				// Both constructors hand back an error of their own kind unchanged, with its item index already set.
				if (error instanceof NodeOperationError) throw new NodeOperationError(this.getNode(), error, { itemIndex });
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
			}
		}

		return [returnData];
	}
}
