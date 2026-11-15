import { createHmac } from 'node:crypto';
import type {
	IBinaryData,
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestOptions,
	INode,
	INodeExecutionData,
	IWebhookFunctions,
} from 'n8n-workflow';
import { vi } from 'vitest';

/**
 * Stand-ins for the function contexts n8n hands a node. Only n8n's helpers are faked: the node's own code (the
 * transport, retries, signing) runs for real, and nothing reaches a network.
 */

export const NODE: INode = {
	id: 'node-1',
	name: 'BlueBot',
	type: 'n8n-nodes-bluebot.blueBot',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

export const CREDENTIALS = { apiKey: 'bb_test_abc', baseUrl: 'https://usebluebot.com/api/v1' };

/** One queued answer from the fake API: a status, body and headers, or an error the request throws. */
export type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

export interface RecordedCall {
	credentialType: string;
	options: IHttpRequestOptions;
}

export function fakeApi(replies: Reply[]) {
	const queue = [...replies];
	const calls: RecordedCall[] = [];
	const httpRequestWithAuthentication = vi.fn(async (credentialType: string, options: IHttpRequestOptions) => {
		calls.push({ credentialType, options: { ...options, headers: { ...(options.headers ?? {}) }, qs: options.qs ? { ...options.qs } : undefined } });
		const reply = queue.shift();
		if (!reply) throw new Error(`No reply queued for ${options.method} ${options.url}`);
		if (reply instanceof Error) throw reply;
		return { statusCode: reply.status ?? 200, headers: reply.headers ?? {}, body: reply.body ?? {}, statusMessage: '' };
	});
	return { calls, httpRequestWithAuthentication, remaining: () => queue.length };
}

type Params = Record<string, unknown>;

export interface ExecuteOptions {
	/** The node's parameters, the same for every item, or one set per item. */
	params: Params | Params[];
	items?: INodeExecutionData[];
	replies?: Reply[];
	credentials?: IDataObject;
	continueOnFail?: boolean;
	executionId?: string;
	timezone?: string;
	/** What `helpers.httpRequest` (the unauthenticated file download) answers. */
	download?: Buffer;
}

export function executeContext(options: ExecuteOptions) {
	const api = fakeApi(options.replies ?? []);
	const items: INodeExecutionData[] = options.items ?? [{ json: {} }];
	const paramsFor = (itemIndex: number): Params => (Array.isArray(options.params) ? (options.params[itemIndex] ?? {}) : options.params);
	const httpRequest = vi.fn<(request: IHttpRequestOptions) => Promise<Buffer>>(async () => options.download ?? Buffer.alloc(0));

	const context = {
		getInputData: () => items,
		getNode: () => NODE,
		getExecutionId: () => options.executionId ?? 'exec-1',
		getTimezone: () => options.timezone ?? 'UTC',
		continueOnFail: () => options.continueOnFail ?? false,
		getCredentials: vi.fn(async () => options.credentials ?? CREDENTIALS),
		getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
			const params = paramsFor(itemIndex);
			if (name in params) return params[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`The test set no parameter "${name}".`);
		},
		helpers: {
			httpRequestWithAuthentication: api.httpRequestWithAuthentication,
			httpRequest,
			assertBinaryData: (itemIndex: number, propertyName: string): IBinaryData => {
				const binary = items[itemIndex]?.binary?.[propertyName];
				if (!binary) throw new Error(`Item ${itemIndex} has no binary property "${propertyName}".`);
				return binary;
			},
			getBinaryDataBuffer: async (itemIndex: number, propertyName: string) => Buffer.from(items[itemIndex]!.binary![propertyName]!.data, 'base64'),
			prepareBinaryData: async (data: Buffer, fileName?: string, mimeType?: string): Promise<IBinaryData> => ({
				data: data.toString('base64'),
				fileName,
				mimeType: mimeType ?? 'application/octet-stream',
			}),
			returnJsonArray: (data: IDataObject | IDataObject[]) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
		},
		logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	};
	return { context: context as unknown as IExecuteFunctions, calls: api.calls, api, httpRequest };
}

/** A binary property as n8n keeps it on an item. */
export function binaryOf(bytes: Buffer, fileName: string, mimeType: string): IBinaryData {
	return { data: bytes.toString('base64'), fileName, mimeType };
}

export interface HookOptions {
	params?: Params;
	staticData?: IDataObject;
	replies?: Reply[];
	webhookUrl?: string;
	workflowName?: string;
}

export function hookContext(options: HookOptions = {}) {
	const api = fakeApi(options.replies ?? []);
	const staticData: IDataObject = options.staticData ?? {};
	const params = options.params ?? { events: ['message.received'] };
	const context = {
		getNode: () => ({ ...NODE, name: 'BlueBot Trigger', type: 'n8n-nodes-bluebot.blueBotTrigger' }),
		getWorkflow: () => ({ id: 'wf-1', name: options.workflowName ?? 'Replies to reminders', active: true }),
		getWorkflowStaticData: (type: string) => {
			if (type !== 'node') throw new Error('The trigger keeps its state per node.');
			return staticData;
		},
		getNodeWebhookUrl: (name: string) => (name === 'default' ? (options.webhookUrl ?? 'https://n8n.example.com/webhook/abc/webhook') : undefined),
		getNodeParameter: (name: string, fallback?: unknown) => (name in params ? params[name] : fallback),
		getCredentials: vi.fn(async () => CREDENTIALS),
		helpers: { httpRequestWithAuthentication: api.httpRequestWithAuthentication },
		logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	};
	return { context: context as unknown as IHookFunctions, calls: api.calls, staticData, api };
}

export interface WebhookOptions {
	rawBody: Buffer | undefined;
	headers: Record<string, string>;
	params?: Params;
	staticData?: IDataObject;
}

export function webhookContext(options: WebhookOptions) {
	const params = options.params ?? { events: ['message.received'], output: 'record' };
	const response = {
		statusCode: 200,
		body: undefined as unknown,
		status(code: number) {
			this.statusCode = code;
			return this;
		},
		json(body: unknown) {
			this.body = body;
			return this;
		},
		send(body: unknown) {
			this.body = body;
			return this;
		},
		end() {
			return this;
		},
	};
	const request = { rawBody: options.rawBody, readRawBody: vi.fn(async () => undefined), body: {} };
	const context = {
		getNode: () => ({ ...NODE, name: 'BlueBot Trigger', type: 'n8n-nodes-bluebot.blueBotTrigger' }),
		getRequestObject: () => request,
		getResponseObject: () => response,
		getHeaderData: () => options.headers,
		getWorkflowStaticData: () => options.staticData ?? {},
		getNodeParameter: (name: string, fallback?: unknown) => (name in params ? params[name] : fallback),
		helpers: {
			returnJsonArray: (data: IDataObject | IDataObject[]) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
		},
		logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	};
	return { context: context as unknown as IWebhookFunctions, response, request };
}

/** Signs a body the way BlueBot does (Standard Webhooks), so tests can make deliveries the trigger accepts. */
export function sign(rawBody: string | Buffer, secret: string, id: string, timestamp: number): string {
	const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
	const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
	const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`, 'utf8'), body]);
	return `v1,${createHmac('sha256', key).update(signed).digest('base64')}`;
}

/** BlueBot's error body, as the API sends it. */
export function errorBody(code: string, message: string, extra: IDataObject = {}) {
	return {
		error: {
			code,
			message,
			hint: 'Check the fields named in the message and send it again.',
			doc_url: `https://usebluebot.com/docs/errors/${code}`,
			request_id: 'req_1Hq2LxW9cVbN3mKpRtYs0a',
			...extra,
		},
	};
}
