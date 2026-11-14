#!/usr/bin/env node
// npx budgethelm            -> same as the one-line installer: one browser approval, then hooks + MCP + usage upload
// npx budgethelm --help     -> all options of the connect script (detect only, --send, --uninstall, ...)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(`Budgethelm needs Node.js 18 or newer (you have ${process.versions.node}).`);
  process.exit(1);
}
const script = fileURLToPath(new URL('../agentops-connect.mjs', import.meta.url));
const args = process.argv.slice(2);
const r = spawnSync(process.execPath, [script, ...(args.length ? args : ['--setup'])], { stdio: 'inherit' });
if (r.error) { console.error(`Budgethelm: ${r.error.message}`); process.exit(1); }
process.exit(r.status ?? 1);
