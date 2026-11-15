import { config } from '@n8n/node-cli/eslint';

// n8n's own rules for community nodes (the ones `n8n-node lint` runs and verification checks), unchanged for every
// file the package ships. The tests never ship, so the rules about what a node may import, call or hold (Node's
// timers, fixtures' made-up secrets, helpers no node imports) are off for them alone.
export default [
	...config,
	{
		files: ['test/**/*.ts'],
		rules: {
			'@n8n/community-nodes/no-restricted-imports': 'off',
			'@n8n/community-nodes/no-restricted-globals': 'off',
			'@n8n/community-nodes/no-hardcoded-secrets': 'off',
			'@n8n/community-nodes/no-dead-files': 'off',
			'@n8n/community-nodes/require-node-api-error': 'off',
			'@n8n/community-nodes/missing-paired-item': 'off',
		},
	},
];
