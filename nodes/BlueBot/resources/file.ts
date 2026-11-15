import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { defaultIdempotencyKey } from '../../shared/idempotency';
import { multipartBody } from '../../shared/multipart';
import { CLIENT_HEADER, CLIENT_NAME, blueBotApiRequest } from '../../shared/transport';
import type { ResourceDefinition } from './types';
import { itemsOf, segment, showFor, stringParam } from './types';

const RESOURCE = 'file';

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{ name: 'Get', value: 'get', description: 'Get a file, and its bytes if you ask', action: 'Get a file' },
			{ name: 'Upload', value: 'upload', description: 'Upload a file to send with a text', action: 'Upload a file' },
		],
		default: 'upload',
	},

	// Upload
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		displayOptions: showFor(RESOURCE, ['upload']),
		default: 'data',
		hint: 'The name of the input binary field containing the file to upload',
		description: 'Up to 25 MB: a picture, video, audio, a PDF or a contact card (.vcf)',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(RESOURCE, ['upload']),
		default: {},
		options: [
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'A name to send it under, if not the file’s own',
			},
		],
	},

	// Get
	{
		displayName: 'File ID',
		name: 'fileId',
		type: 'string',
		required: true,
		displayOptions: showFor(RESOURCE, ['get']),
		default: '',
		placeholder: 'file_1Hq2LxW9cVbN3mKpRtYs0a',
		description: 'The file’s file_ ID',
	},
	{
		displayName: 'Download',
		name: 'download',
		type: 'boolean',
		displayOptions: showFor(RESOURCE, ['get']),
		default: false,
		description: 'Whether to put the file’s bytes in a binary field as well, such as a picture or voice memo someone sent you',
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		displayOptions: { show: { resource: [RESOURCE], operation: ['get'], download: [true] } },
		default: 'data',
		hint: 'The name of the output binary field to put the file in',
	},
];

/**
 * Uploads one binary property of an item (`POST /v1/files`) and answers the File. Used by File → Upload and by
 * Send Text when its files are binary properties.
 */
export async function uploadBinary(this: IExecuteFunctions, itemIndex: number, propertyName: string, name: string | undefined, idempotencyKey: string): Promise<IDataObject> {
	const binary = this.helpers.assertBinaryData(itemIndex, propertyName);
	const data = await this.helpers.getBinaryDataBuffer(itemIndex, propertyName);
	const parts: Parameters<typeof multipartBody>[0] = [
		{
			name: 'file',
			filename: binary.fileName || `${propertyName}${binary.fileExtension ? `.${binary.fileExtension}` : ''}`,
			contentType: binary.mimeType || 'application/octet-stream',
			data,
		},
	];
	if (name) parts.push({ name: 'name', value: name });
	const { body, contentType } = multipartBody(parts, idempotencyKey);
	return await blueBotApiRequest.call(this, {
		method: 'POST',
		path: '/files',
		body,
		headers: { 'Content-Type': contentType },
		idempotencyKey,
		itemIndex,
	});
}

async function upload(this: IExecuteFunctions, itemIndex: number) {
	const propertyName = stringParam.call(this, 'binaryPropertyName', itemIndex);
	const fields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	const name = typeof fields.name === 'string' && fields.name.trim() ? fields.name.trim() : undefined;
	const file = await uploadBinary.call(this, itemIndex, propertyName, name, defaultIdempotencyKey.call(this, itemIndex));
	return itemsOf(file, itemIndex);
}

/** Reads the file's signed link (good for an hour). It needs no key, so none is sent with it. */
async function downloadFile(this: IExecuteFunctions, url: string, itemIndex: number): Promise<Buffer> {
	try {
		const bytes: unknown = await this.helpers.httpRequest({
			method: 'GET',
			url,
			encoding: 'arraybuffer',
			headers: { [CLIENT_HEADER]: CLIENT_NAME },
		});
		return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as ArrayBuffer);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex, message: 'BlueBot’s link to the file couldn’t be read.' });
	}
}

async function get(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const id = stringParam.call(this, 'fileId', itemIndex);
	const file = await blueBotApiRequest.call(this, { method: 'GET', path: `/files/${segment(id)}`, itemIndex });
	const download = this.getNodeParameter('download', itemIndex, false) as boolean;
	if (!download || typeof file.url !== 'string' || !file.url) return itemsOf(file, itemIndex);
	const propertyName = stringParam.call(this, 'binaryPropertyName', itemIndex) || 'data';
	const bytes = await downloadFile.call(this, file.url, itemIndex);
	const binary = await this.helpers.prepareBinaryData(bytes, typeof file.name === 'string' ? file.name : undefined, typeof file.content_type === 'string' ? file.content_type : undefined);
	return [{ json: file, binary: { [propertyName]: binary }, pairedItem: { item: itemIndex } }];
}

export const file: ResourceDefinition = {
	option: { name: 'File', value: RESOURCE },
	properties,
	handlers: { upload, get },
};
