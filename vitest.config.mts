import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// n8n loads a community node's `require('n8n-workflow')` from the CommonJS build, so the tests do too. (The
		// ESM build also imports without file extensions, which only Vite's own runner can load.)
		alias: { 'n8n-workflow': fileURLToPath(new URL('./node_modules/n8n-workflow/dist/cjs/index.js', import.meta.url)) },
	},
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		// Tests never reach a network; a stray request would fail rather than wait.
		testTimeout: 10000,
	},
});
