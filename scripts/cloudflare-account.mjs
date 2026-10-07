import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = 'gofg-kawakahi';
const mode = process.argv[2];
const commands = {
  login: ['auth', 'create', profile, '--browser=false', '--scopes',
    'account:read', 'user:read', 'workers_scripts:write'],
  'login-storage': ['auth', 'create', profile, '--browser=false', '--scopes', 'account:read', 'user:read', 'workers_scripts:write', 'd1:write'],
  'storage-list': ['d1', 'list', '--profile', profile, '--config', path.join(root, '.wrangler/deploy.wrangler.jsonc')],
  'storage-create': ['d1', 'create', 'gofg-exterior-sketch', '--profile', profile, '--config', path.join(root, '.wrangler/deploy.wrangler.jsonc')],
  'storage-migrate': ['d1', 'migrations', 'apply', 'gofg-exterior-sketch', '--remote', '--profile', profile, '--config', path.join(root, '.wrangler/deploy.wrangler.jsonc')],
  activate: ['auth', 'activate', profile, root],
  status: ['whoami'],
  deploy: ['deploy', '--profile', profile, '--config', path.join(root, '.wrangler/deploy.wrangler.jsonc'), ...(process.argv.includes('--dry-run') ? ['--dry-run'] : [])],
};
if (!commands[mode]) {
  console.error('Usage: node scripts/cloudflare-account.mjs login|login-storage|activate|status|deploy|storage-list|storage-create|storage-migrate [--dry-run]');
  process.exit(1);
}
// A machine-wide API token overrides OAuth profiles. Exclude it only in this child process.
const env = { ...process.env };
for (const key of [
  'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY',
  'CLOUDFLARE_EMAIL', 'CF_EMAIL', 'CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID',
]) delete env[key];
const result = spawnSync(process.execPath,
  [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), ...commands[mode]],
  { cwd: root, env, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
