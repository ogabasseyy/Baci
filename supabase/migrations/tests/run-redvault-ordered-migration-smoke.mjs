import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRedvaultEphemeralCluster } from './redvault-ephemeral-cluster.mjs';
import { runSmokeLegacyChecks } from './redvault-smoke-legacy-checks.mjs';
import { replaySmokeLegacyCore } from './redvault-smoke-legacy-core.mjs';
import { runSmokePilotPhases } from './redvault-smoke-pilot-phases.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(directory, '..');
const cluster = createRedvaultEphemeralCluster({
  port: '55480',
  prefix: 'baci-redvault-ordered-',
});

let running = false;
try {
  cluster.start();
  running = true;
  const context = {
    directory,
    migrations,
    port: cluster.port,
    root: cluster.root,
    sql: cluster.sql,
  };
  const slices = await replaySmokeLegacyCore(context);
  await runSmokeLegacyChecks({ ...context, ...slices });
  await runSmokePilotPhases(context);
} finally {
  if (running) cluster.stop();
  cluster.remove();
  process.stdout.write('Ordered temporary cluster stopped and removed.\n');
}
