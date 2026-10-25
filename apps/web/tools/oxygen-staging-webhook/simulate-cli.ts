import { mkdir, mkdtemp } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { simulateStagingCallbacks } from './simulate';

const parent = join(
  homedir(),
  '.local/state/baci-oxygen/staging-webhook/simulations'
);
await mkdir(parent, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(join(parent, 'sample-'));
try {
  const result = await simulateStagingCallbacks(directory);
  console.log(
    JSON.stringify({ ...result, evidenceDirectory: directory }, null, 2)
  );
} catch {
  console.error(
    'Simulation failed; inspect the isolated simulation evidence. Live staging inbox unchanged.'
  );
  process.exitCode = 1;
}
