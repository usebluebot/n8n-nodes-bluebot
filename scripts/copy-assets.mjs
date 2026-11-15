#!/usr/bin/env node
// Copies what tsc doesn't: the icons and each node's codex file (`*.node.json`), next to the built files that use them.
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
let copied = 0;

function walk(dir, keep) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, keep);
		else if (keep(name)) {
			const target = join(dist, relative(root, path));
			mkdirSync(dirname(target), { recursive: true });
			copyFileSync(path, target);
			copied++;
		}
	}
}

walk(resolve(root, 'icons'), (name) => name.endsWith('.svg') || name.endsWith('.png'));
walk(resolve(root, 'nodes'), (name) => name.endsWith('.node.json') || name.endsWith('.svg') || name.endsWith('.png'));
walk(resolve(root, 'credentials'), (name) => name.endsWith('.svg') || name.endsWith('.png'));
console.log(`n8n: copied ${copied} assets into dist`);
