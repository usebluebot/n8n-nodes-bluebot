import { randomUUID } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';
import { EVENT_OPTIONS } from '../shared/api.generated';
import { verifySignature } from '../shared/signature';
import { BlueBotApiError, blueBotApiRequest, blueBotApiRequestAllItems, describeFailure, failureResponse } from '../shared/transport';

/** What the node keeps in the workflow's static data about the webhook it made. */
interface TriggerState extends IDataObject {
	webhookId?: string;
	webhookSecret?: string;
}

const DESCRIPTION_LIMIT = 200;

function sameEvents(a: unknown, b: string[]): boolean {
	if (!Array.isArray(a)) return false;
	const left = [...new Set(a.map(String))].sort();
	const right = [...new Set(b)].sort();
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isNotFound(error: unknown): boolean {
	return error instanceof BlueBotApiError && error.failure.status === 404;
}

export class BlueBotTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'BlueBot Trigger',
		name: 'blueBotTrigger',
		icon: { light: 'file:../../icons/bluebot.svg', dark: 'file:../../icons/bluebot.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when BlueBot posts an event, such as a text coming in',
		defaults: {
			name: 'BlueBot Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'blueBotApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				options: EVENT_OPTIONS,
				default: ['message.received'],
				description: 'The events that start the workflow',
			},
			{
				displayName: 'Output',
				name: 'output',
				type: 'options',
				options: [
					{ name: 'Record', value: 'record', description: 'The event’s data: the message, contact or enrollment' },
					{ name: 'Whole Event', value: 'event', description: 'The data with the envelope: ID, type, API version and timestamp' },
				],
				default: 'record',
				description: 'What each event puts in the workflow',
			},
		],
	};

	webhookMethods = {
		default: {
			/** True when the webhook this node made still exists, points here and listens for the chosen events. */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as TriggerState;
				if (!state.webhookId || !state.webhookSecret) return false;
				const url = this.getNodeWebhookUrl('default');
				const events = this.getNodeParameter('events', []) as string[];

				let webhook: IDataObject;
				try {
					webhook = await blueBotApiRequest.call(this, { method: 'GET', path: `/webhooks/${encodeURIComponent(state.webhookId)}` });
				} catch (error) {
					if (!isNotFound(error)) throw new NodeApiError(this.getNode(), error as JsonObject);
					this.logger.debug('The BlueBot webhook this trigger made is gone; it will make a new one.', { webhookId: state.webhookId });
					delete state.webhookId;
					delete state.webhookSecret;
					return false;
				}

				if (webhook.url !== url || !sameEvents(webhook.events, events)) {
					// It points at another address or listens for other events: replace it rather than leave it delivering.
					await blueBotApiRequest.call(this, { method: 'DELETE', path: `/webhooks/${encodeURIComponent(state.webhookId)}` }).catch((error: unknown) => {
						if (!isNotFound(error)) throw new NodeApiError(this.getNode(), error as JsonObject);
					});
					delete state.webhookId;
					delete state.webhookSecret;
					return false;
				}

				if (webhook.status === 'paused' && webhook.pause_reason === 'failing') {
					// BlueBot paused it after 72 hours of failures; the workflow is active again, so let it deliver.
					await blueBotApiRequest.call(this, { method: 'PATCH', path: `/webhooks/${encodeURIComponent(state.webhookId)}`, body: { paused: false } });
				}
				return true;
			},

			/** Makes a BlueBot webhook to this node's URL and keeps its id and signing secret. */
			async create(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as TriggerState;
				const url = this.getNodeWebhookUrl('default') as string;
				const events = this.getNodeParameter('events', []) as string[];
				const workflowName = this.getWorkflow().name || 'workflow';
				const description = `n8n: ${workflowName}`.slice(0, DESCRIPTION_LIMIT);

				// A webhook to this same address left behind by an earlier activation would deliver with a secret this
				// node no longer has, so it goes first.
				const existing = await blueBotApiRequestAllItems.call(this, { method: 'GET', path: '/webhooks' });
				for (const stale of existing) {
					if (stale.url !== url || typeof stale.id !== 'string') continue;
					await blueBotApiRequest.call(this, { method: 'DELETE', path: `/webhooks/${encodeURIComponent(stale.id)}` }).catch((error: unknown) => {
						if (!isNotFound(error)) throw new NodeApiError(this.getNode(), error as JsonObject);
					});
				}

				let webhook: IDataObject;
				try {
					webhook = await blueBotApiRequest.call(this, {
						method: 'POST',
						path: '/webhooks',
						body: { url, events, description },
						idempotencyKey: `n8n-trigger-${randomUUID()}`,
					});
				} catch (error) {
					const refusedUrl =
						error instanceof BlueBotApiError &&
						error.failure.code === 'invalid_request' &&
						(error.failure.details ?? []).some((detail) => detail.field === 'url');
					if (refusedUrl) {
						// n8n chose the address, not the person, so say which one and how to change it.
						const { failure } = error as BlueBotApiError;
						const explained = {
							...failure,
							message: 'BlueBot couldn’t reach this URL',
							hint: `${failure.message} n8n gave BlueBot ${url}. Set WEBHOOK_URL to n8n’s public https address, restart n8n and try again.`,
						};
						throw new NodeApiError(this.getNode(), failureResponse(explained), {
							message: explained.message,
							description: describeFailure(explained),
							httpCode: String(failure.status),
						});
					}
					throw new NodeApiError(this.getNode(), error as JsonObject);
				}

				if (typeof webhook.id !== 'string' || typeof webhook.secret !== 'string') {
					throw new NodeApiError(this.getNode(), webhook as JsonObject, { message: 'BlueBot made the webhook but its answer had no id or signing secret.' });
				}
				state.webhookId = webhook.id;
				state.webhookSecret = webhook.secret;
				return true;
			},

			/** Deletes the webhook this node made. One already gone counts as deleted. */
			async delete(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as TriggerState;
				if (state.webhookId) {
					try {
						await blueBotApiRequest.call(this, { method: 'DELETE', path: `/webhooks/${encodeURIComponent(state.webhookId)}` });
					} catch (error) {
						if (!isNotFound(error)) throw new NodeApiError(this.getNode(), error as JsonObject);
						this.logger.debug('The BlueBot webhook this trigger made was already gone.', { webhookId: state.webhookId });
					}
				}
				delete state.webhookId;
				delete state.webhookSecret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const response = this.getResponseObject();
		const state = this.getWorkflowStaticData('node') as TriggerState;

		if (!request.rawBody && typeof request.readRawBody === 'function') await request.readRawBody();
		const raw = request.rawBody;
		const check = state.webhookSecret && raw ? verifySignature(raw, this.getHeaderData(), state.webhookSecret) : { ok: false as const, reason: 'There is no signing secret or no body to check.' };
		if (!check.ok) {
			this.logger.debug('Refused a BlueBot webhook request whose signature didn’t check.', { reason: check.reason });
			response.status(401).json({ error: 'The webhook signature didn’t match.' });
			return { noWebhookResponse: true };
		}

		let event: IDataObject;
		try {
			event = JSON.parse(raw.toString('utf8')) as IDataObject;
		} catch {
			response.status(400).json({ error: 'The body isn’t JSON.' });
			return { noWebhookResponse: true };
		}

		const events = this.getNodeParameter('events', []) as string[];
		if (events.length && !events.includes(String(event.type))) {
			// A type this trigger doesn't listen for (the webhook's events were changed elsewhere): acknowledge it and stop.
			return { webhookResponse: { received: true } };
		}

		const output = this.getNodeParameter('output', 'record') as string;
		const data = event.data && typeof event.data === 'object' ? (event.data as IDataObject) : {};
		return {
			workflowData: [this.helpers.returnJsonArray(output === 'event' ? event : data)],
		};
	}
}
