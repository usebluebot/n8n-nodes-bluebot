import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties, INodePropertyOptions } from 'n8n-workflow';

/** Runs one operation for one input item and answers its output items. */
export type OperationHandler = (this: IExecuteFunctions, itemIndex: number) => Promise<INodeExecutionData[]>;

/**
 * One resource of the BlueBot node: its entry in the Resource list, its fields (the Operation list first), and a
 * handler for each operation. Adding a resource is one file exporting this, plus one line in `index.ts`.
 */
export interface ResourceDefinition {
	option: INodePropertyOptions;
	properties: INodeProperties[];
	handlers: Record<string, OperationHandler>;
}

/** Output items for one input item: one per record, each paired with the item it came from. */
export function itemsOf(data: IDataObject | IDataObject[], itemIndex: number): INodeExecutionData[] {
	const records = Array.isArray(data) ? data : [data];
	return records.map((json) => ({ json, pairedItem: { item: itemIndex } }));
}

/** Show a field only for this resource and these operations. */
export function showFor(resource: string, operations: string[]): INodeProperties['displayOptions'] {
	return { show: { resource: [resource], operation: operations } };
}

/** The Return All and Limit fields every Get Many operation has. */
export function listFields(resource: string, operation: string): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			displayOptions: showFor(resource, [operation]),
			default: false,
			description: 'Whether to return all results or only up to a given limit',
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			displayOptions: { show: { resource: [resource], operation: [operation], returnAll: [false] } },
			typeOptions: {
				minValue: 1,
			},
			default: 50,
			description: 'Max number of results to return',
		},
	];
}

/** Reads Return All and Limit for an item: undefined means every record. */
export function listLimit(this: IExecuteFunctions, itemIndex: number): number | undefined {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	if (returnAll) return undefined;
	return this.getNodeParameter('limit', itemIndex, 50) as number;
}

/** A string parameter, trimmed. */
export function stringParam(this: IExecuteFunctions, name: string, itemIndex: number): string {
	const value = this.getNodeParameter(name, itemIndex, '') as unknown;
	return value === undefined || value === null ? '' : String(value).trim();
}

/** A path segment for an id or a person, encoded so `+1555…` and emails survive. */
export function segment(value: string): string {
	return encodeURIComponent(value);
}

/** Key and value pairs from a Metadata field, as the object the API takes. */
export function metadataOf(field: unknown): IDataObject | undefined {
	const pairs = (field as { metadataValues?: Array<{ key?: unknown; value?: unknown }> } | undefined)?.metadataValues;
	if (!Array.isArray(pairs)) return undefined;
	const metadata: IDataObject = {};
	for (const pair of pairs) {
		const key = pair.key === undefined || pair.key === null ? '' : String(pair.key).trim();
		if (!key) continue;
		metadata[key] = pair.value === undefined || pair.value === null ? '' : String(pair.value);
	}
	return Object.keys(metadata).length ? metadata : undefined;
}

/** The Metadata field: key and value pairs, used by Send Text and Update. */
export const metadataField: INodeProperties = {
	displayName: 'Metadata',
	name: 'metadata',
	type: 'fixedCollection',
	placeholder: 'Add Metadata',
	typeOptions: {
		multipleValues: true,
	},
	default: {},
	description: 'Your own data, echoed on the text and every webhook about it. Up to 20 keys of up to 40 characters, values up to 500.',
	options: [
		{
			displayName: 'Metadata',
			name: 'metadataValues',
			values: [
				{
					displayName: 'Key',
					name: 'key',
					type: 'string',
					default: '',
				},
				{
					displayName: 'Value',
					name: 'value',
					type: 'string',
					default: '',
				},
			],
		},
	],
};
