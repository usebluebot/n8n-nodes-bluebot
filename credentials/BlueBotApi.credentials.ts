import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, Icon, INodeProperties } from 'n8n-workflow';

export class BlueBotApi implements ICredentialType {
	name = 'blueBotApi';

	displayName = 'BlueBot API';

	icon: Icon = { light: 'file:../icons/bluebot.svg', dark: 'file:../icons/bluebot.dark.svg' };

	documentationUrl = 'https://usebluebot.com/docs/n8n#add-your-credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'bb_live_…',
			description:
				'A key from BlueBot’s Developers → API keys page. The trigger needs the webhooks:manage scope, and this test needs account:read.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://usebluebot.com/api/v1',
			description: 'Leave it as it is unless BlueBot support asks you to change it',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
				'BlueBot-Client': 'n8n',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl || "https://usebluebot.com/api/v1"}}',
			url: '/me',
			method: 'GET',
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message: 'That key isn’t valid. It may have been revoked. Make a new key on BlueBot’s Developers page.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 403,
					message: 'This key doesn’t have the account:read scope, which the test needs. Make a key with it on BlueBot’s Developers page.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 404,
					message: 'BlueBot’s API isn’t at that Base URL. Set it back to https://usebluebot.com/api/v1.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 429,
					message: 'Too many requests with this key in the last minute. Wait a minute and test it again.',
				},
			},
		],
	};
}
