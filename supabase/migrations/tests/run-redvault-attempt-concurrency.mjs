import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runConcurrencyLegacyRaces } from './redvault-concurrency-legacy-races.mjs';
import { runConcurrencyPilotCases } from './redvault-concurrency-pilot-cases.mjs';
import { createRedvaultEphemeralCluster } from './redvault-ephemeral-cluster.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(directory, '..');
const cluster = createRedvaultEphemeralCluster({
  port: '55480',
  prefix: 'baci-redvault-attempt-',
});

let running = false;
try {
  cluster.start();
  running = true;
  const context = {
    concurrentSql: cluster.concurrentSql,
    directory,
    migrations,
    sql: cluster.sql,
  };
  await runConcurrencyLegacyRaces(context);
  await runConcurrencyPilotCases(context);
} finally {
  if (running) cluster.stop();
  cluster.remove();
  process.stdout.write('Owned temporary cluster stopped and removed.\n');
}
