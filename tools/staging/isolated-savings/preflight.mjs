import { execFileSync } from 'node:child_process';
import { assertFreshOwnership } from './ownership.mjs';
import { validateSetup } from './setup-validation.mjs';

try {
  if (process.argv.length !== 3 || process.argv[2] !== '--fresh-private') {
    throw new Error('Usage: node preflight.mjs --fresh-private');
  }
  validateSetup(process.env);
  const run = (args) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 10000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const context = run([
    'context',
    'inspect',
    '--format',
    '{{.Endpoints.docker.Host}}',
  ]).trim();
  if (context !== 'unix:///var/run/docker.sock')
    throw new Error('VPS local Docker socket required');
  run(['compose', 'version']);
  assertFreshOwnership(run);
  process.stdout.write(
    'Fresh private resource preflight passed; no resources created.\n'
  );
} catch {
  process.stderr.write(
    'Private setup preflight rejected; check inputs, local Compose and resource ownership.\n'
  );
  process.exitCode = 1;
}
