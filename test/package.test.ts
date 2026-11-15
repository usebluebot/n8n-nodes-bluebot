import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { IDataObject, INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { BlueBotApi } from '../credentials/BlueBotApi.credentials';
import { BlueBot } from '../nodes/BlueBot/BlueBot.node';
import { RESOURCES } from '../nodes/BlueBot/resources';
import { BlueBotTrigger } from '../nodes/BlueBotTrigger/BlueBotTrigger.node';
import { API_VERSION, DELIVERY_STATE_OPTIONS, EVENT_OPTIONS, EVENT_TYPES, MESSAGE_SOURCE_OPTIONS, MESSAGE_STATE_OPTIONS } from '../nodes/shared/api.generated';
import { EXAMPLES } from './examples';

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path: string) => readFileSync(root(path), 'utf8');

/**
 * Resolves the credential's two expressions the way n8n would: `{{$credentials.apiKey}}` and
 * `{{$credentials.baseUrl || "…"}}`. Anything else fails the test rather than guess.
 */
function resolve(expression: string, credentials: IDataObject): string {
	if (!expression.startsWith('=')) return expression;
	return expression.slice(1).replace(/\{\{([^}]+)\}\}/g, (_match, code: string) => {
		const parsed = /^\s*\$credentials\.(\w+)(?:\s*\|\|\s*"([^"]*)")?\s*$/.exec(code);
		if (!parsed) throw new Error(`The test can't resolve {{${code}}}.`);
		const value = credentials[parsed[1]];
		return value ? String(value) : (parsed[2] ?? '');
	});
}

describe('credential', () => {
	const credential = new BlueBotApi();

	it('is BlueBot API, with an API Key kept as a password and a Base URL', () => {
		expect(credential.name).toBe('blueBotApi');
		expect(credential.displayName).toBe('BlueBot API');
		const [apiKey, baseUrl] = credential.properties;
		expect(apiKey).toMatchObject({ displayName: 'API Key', name: 'apiKey', type: 'string', required: true, typeOptions: { password: true } });
		expect(baseUrl).toMatchObject({ displayName: 'Base URL', name: 'baseUrl', default: 'https://usebluebot.com/api/v1' });
	});

	it('sends the key as a bearer token, with BlueBot-Client: n8n', () => {
		const headers = credential.authenticate.properties.headers as Record<string, string>;
		expect(resolve(headers.Authorization, { apiKey: 'bb_test_abc' })).toBe('Bearer bb_test_abc');
		expect(headers['BlueBot-Client']).toBe('n8n');
	});

	it('tests the key with GET /me at the Base URL, or at BlueBot’s when it is blank', () => {
		const { request } = credential.test;
		expect(request.method).toBe('GET');
		expect(request.url).toBe('/me');
		expect(resolve(String(request.baseURL), { baseUrl: 'https://staging.example.com/api/v1' })).toBe('https://staging.example.com/api/v1');
		expect(resolve(String(request.baseURL), { baseUrl: '' })).toBe('https://usebluebot.com/api/v1');
		expect(EXAMPLES.operations.getMe).toMatchObject({ method: 'GET', path: '/me' });
	});

	it('says what each refusal of the test means', () => {
		const rules = credential.test.rules?.map((rule) => [rule.properties.value, rule.properties.message]);
		expect(rules).toEqual([
			[401, 'That key isn’t valid. It may have been revoked. Make a new key on BlueBot’s Developers page.'],
			[403, 'This key doesn’t have the account:read scope, which the test needs. Make a key with it on BlueBot’s Developers page.'],
			[404, 'BlueBot’s API isn’t at that Base URL. Set it back to https://usebluebot.com/api/v1.'],
			[429, 'Too many requests with this key in the last minute. Wait a minute and test it again.'],
		]);
		const statuses = new Set(Object.values(EXAMPLES.errors).map((error) => error.status));
		for (const [status] of rules ?? []) expect(statuses.has(Number(status))).toBe(true);
	});
});

describe('BlueBot node description', () => {
	const description = new BlueBot().description;
	const operationsOf = (resource: string) =>
		description.properties.find((property) => property.name === 'operation' && property.displayOptions?.show?.resource?.includes(resource)) as INodeProperties;

	it('lists the resources and operations the docs page names', () => {
		const names = Object.fromEntries(
			RESOURCES.map((resource) => [resource.option.name, (operationsOf(String(resource.option.value)).options as INodePropertyOptions[]).map((option) => option.name).sort()]),
		);
		expect(names).toEqual({
			Account: ['Get'],
			Chat: ['Get', 'Get Many'],
			Conversation: ['Get', 'Get Many'],
			Device: ['Get BlueBot Status', 'Get Mac'],
			Event: ['Get', 'Get Many'],
			File: ['Get', 'Upload'],
			Lookup: ['Check iMessage'],
			Message: ['Cancel', 'Get', 'Get Many', 'Resolve', 'Send Text', 'Update'],
			Settings: ['Get', 'Update'],
			Stop: ['Add', 'Get Many', 'Remove'],
			Template: ['Get', 'Get Many'],
			Webhook: ['Create', 'Delete', 'Get', 'Get Many', 'Rotate Secret', 'Send Test Event', 'Update'],
			'Webhook Delivery': ['Get Many', 'Replay'],
		});
	});

	it('has a handler for every operation it offers, and offers every handler', () => {
		for (const resource of RESOURCES) {
			const offered = (operationsOf(String(resource.option.value)).options as INodePropertyOptions[]).map((option) => option.value).sort();
			expect(Object.keys(resource.handlers).sort()).toEqual(offered);
		}
	});

	it('is usable as an AI tool and needs the BlueBot API credential', () => {
		expect(description.usableAsTool).toBe(true);
		expect(description.credentials).toEqual([{ name: 'blueBotApi', required: true }]);
	});

	it('offers every message state, source and delivery state the API filters by', () => {
		expect(MESSAGE_STATE_OPTIONS.length).toBeGreaterThan(0);
		expect(MESSAGE_SOURCE_OPTIONS.map((option) => option.value)).toContain('n8n');
		expect(DELIVERY_STATE_OPTIONS.length).toBeGreaterThan(0);
		expect(API_VERSION).toBe(EXAMPLES.apiVersion);
		expect([...EVENT_TYPES].sort()).toEqual(Object.keys(EXAMPLES.events).sort());
		expect(EVENT_OPTIONS.map((option) => option.value).sort()).toEqual([...EVENT_TYPES].sort());
	});
});

describe('package', () => {
	const pkg = JSON.parse(read('package.json')) as IDataObject & { n8n: { credentials: string[]; nodes: string[] }; dependencies?: IDataObject };

	it('lists every built credential and node, each from a source file', () => {
		expect(pkg.n8n.credentials).toEqual(['dist/credentials/BlueBotApi.credentials.js']);
		expect(pkg.n8n.nodes).toEqual(['dist/nodes/BlueBot/BlueBot.node.js', 'dist/nodes/BlueBotTrigger/BlueBotTrigger.node.js']);
		for (const built of [...pkg.n8n.credentials, ...pkg.n8n.nodes]) {
			expect(existsSync(root(built.replace(/^dist\//, '').replace(/\.js$/, '.ts')))).toBe(true);
		}
	});

	it('has no runtime dependencies and the community node keyword', () => {
		expect(pkg.dependencies ?? {}).toEqual({});
		expect(pkg.keywords).toContain('n8n-community-node-package');
		expect(pkg.license).toBe('MIT');
	});

	it('has a codex file beside each node, linking BlueBot’s docs', () => {
		for (const [file, name] of [
			['nodes/BlueBot/BlueBot.node.json', 'n8n-nodes-bluebot.blueBot'],
			['nodes/BlueBotTrigger/BlueBotTrigger.node.json', 'n8n-nodes-bluebot.blueBotTrigger'],
		]) {
			const codex = JSON.parse(read(file));
			expect(codex.node).toBe(name);
			expect(codex.categories).toEqual(['Communication']);
			expect(codex.resources.primaryDocumentation[0].url).toMatch(/^https:\/\/usebluebot\.com\/docs\/n8n/);
		}
	});

	it('has both icons, which the trigger shares', () => {
		expect(read('icons/bluebot.svg')).toContain('<svg');
		expect(read('icons/bluebot.dark.svg')).toContain('<svg');
		expect(new BlueBotTrigger().description.icon).toEqual(new BlueBot().description.icon);
	});
});

describe('generated files', () => {
	const manifest = root('../../packages/codegen/manifest.json');

	it.skipIf(!existsSync(manifest))('match the API manifest (run npm run generate when this fails)', async () => {
		const { render } = (await import(root('scripts/generate.mjs'))) as { render: (manifest: unknown) => { options: string; examples: string } };
		const rendered = render(JSON.parse(readFileSync(manifest, 'utf8')));
		expect(read('nodes/shared/api.generated.ts')).toBe(rendered.options);
		expect(read('test/examples.generated.json')).toBe(rendered.examples);
	});
});
