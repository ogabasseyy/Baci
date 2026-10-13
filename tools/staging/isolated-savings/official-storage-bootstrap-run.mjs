import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { officialStorageBootstrap } from './official-storage-bootstrap.mjs';
import { storageBootstrapSequence } from './official-storage-bootstrap-sequence.mjs';

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--execute-reviewed-private') throw new Error('Explicit execution required');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 16384) throw new Error('Oversized input');
  }
  const evidence = JSON.parse(input);
  const config = officialStorageBootstrap(evidence, Date.now());
  const password = process.env.ISOLATED_STORAGE_DB_PASSWORD;
  const jwt = process.env.ISOLATED_JWT_SECRET;
  if (!/^[a-f0-9]{64}$/.test(password ?? '') || typeof jwt !== 'string' || jwt.length < 32 || password === jwt) throw new Error('Secure setup required');
  if (process.env.ISOLATED_STORAGE_EXECUTION_REVIEW !== 'approved-with-lifecycle-lock') throw new Error('Parent lifecycle review required');
  const environment = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    ISOLATED_STORAGE_DB_PASSWORD: password, ISOLATED_JWT_SECRET: jwt,
  };
  const docker = (args, body, timeout = 15000) => execFileSync('docker', args, {
    input: body, encoding: 'utf8', timeout, env: environment,
    stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 65536,
  }).trim();
  if (docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']) !== 'unix:///var/run/docker.sock') throw new Error('Local VPS Docker required');
  docker(['compose', 'version']);
  const dbFormat = '{{json .Id}}|{{json .Config.Image}}|{{json .Config.Labels}}|{{json .State.Health.Status}}|{{json .NetworkSettings.Networks}}';
  const parts = docker(['inspect', '--type', 'container', '--format', dbFormat, evidence.db.id]).split('|').map((part) => JSON.parse(part));
  if (parts[0] !== evidence.db.id || parts[1] !== evidence.db.image || parts[2]['com.docker.compose.project'] !== evidence.db.project || parts[2]['com.docker.compose.service'] !== 'db' || parts[3] !== 'healthy') throw new Error('Database identity mismatch');
  if (Object.keys(parts[4]).length !== 1 || parts[4][evidence.network.name]?.NetworkID !== evidence.network.id) throw new Error('Database network mismatch');
  const networkFormat = '{{json .Id}}|{{json .Name}}|{{json .Internal}}|{{json .Options}}|{{json .Labels}}|{{json .Containers}}';
  const network = docker(['network', 'inspect', '--format', networkFormat, evidence.network.id]).split('|').map((part) => JSON.parse(part));
  if (network[0] !== evidence.network.id || network[1] !== evidence.network.name || network[2] !== true || network[3]['com.docker.network.bridge.name'] !== 'baci-stg-db' || network[4]['com.docker.compose.project'] !== 'baci-isolated-savings' || !network[5][evidence.db.id]) throw new Error('Network identity mismatch');
  if (docker(['container', 'ls', '--all', '--quiet', '--filter', 'label=com.docker.compose.project=baci-isolated-savings', '--filter', 'label=com.docker.compose.service=storage-bootstrap'])) throw new Error('Existing bootstrap worker requires review');
  const workerName = `baci-storage-bootstrap-${randomUUID()}`;
  const admin = (stage) => docker([
    'exec', '--interactive', '--env', 'ISOLATED_STORAGE_DB_PASSWORD', evidence.db.id,
    'psql', '-X', '--username', 'supabase_admin', '--dbname', 'postgres', '--file', '-',
  ], readFileSync(new URL(`./official-storage-bootstrap-${stage}.sql`, import.meta.url), 'utf8'));
  let startAttempted = false;
  await storageBootstrapSequence({
    prepare: async () => { admin('prepare'); },
    migrate: async () => {
      startAttempted = true;
      const workerId = docker([
        'compose', '--env-file', '/dev/null', '-p', 'baci-isolated-savings', '-f', '-',
        '--profile', 'official-storage-bootstrap', 'run', '--detach', '--no-deps',
        '--pull', 'never', '--name', workerName, 'storage-bootstrap',
      ], JSON.stringify(config), 60000);
      if (!/^[a-f0-9]{64}$/.test(workerId)) throw new Error('Unexpected worker identity');
      if (docker(['wait', workerId], undefined, 600000) !== '0') throw new Error('Migration failed');
    },
    lockdown: async () => { admin('lockdown'); },
    stop: async () => {
      if (!startAttempted) return;
      const id = docker(['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter', `name=^/${workerName}$`]);
      if (!id) return;
      docker(['stop', '--time', '10', id], undefined, 30000);
    },
    verify: async () => { admin('verify'); },
  });
  process.stdout.write('Official Storage migrations verified; initializer NOLOGIN, worker stopped.\n');
}

main().catch(() => {
  process.stderr.write('Storage bootstrap failed; inspect status only and confirm initializer lockdown through the admin channel.\n');
  process.exitCode = 1;
});
