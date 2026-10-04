import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReplayCommand } from './supabase-history-replay-types';
import { createSupabaseReplayDatabaseEnvironment } from './supabase-replay-contract';

const RETENTION_SOURCE = '20261004071812_connector_retention_one_year.sql';
const RETENTION_SHA256 =
  '20f6c46c02d9d5924ffdf9bfe9571a51ce61d8c8e9e56bfcb3d8df8213c7fa20';

/** Supplies a production-managed prerequisite only inside the owned local replay. */
export function createSupabaseReplaySqlApplier(
  run: ReplayCommand,
  psqlBin: string,
  databaseUrl: string
) {
  // Rejects non-loopback URLs and passes credentials only through the environment.
  const env = createSupabaseReplayDatabaseEnvironment(databaseUrl);
  const args = [
    '-X',
    '-w',
    '-v',
    'ON_ERROR_STOP=1',
    '-v',
    'VERBOSITY=sqlstate',
  ];
  return async (sqlPath: string) => {
    const name = path.basename(sqlPath).replace(/^\d+-/, '');
    if (name === RETENTION_SOURCE) {
      const bytes = await readFile(sqlPath);
      if (
        createHash('sha256').update(bytes).digest('hex') !== RETENTION_SHA256
      ) {
        throw new Error('Connector retention replay source hash mismatch');
      }
      // Provision the managed extension using the normal local database owner.
      await run(psqlBin, [...args, '-f', '-'], {
        env,
        input: 'CREATE EXTENSION IF NOT EXISTS pg_cron;',
      });
      // Create and deactivate the replay schedule in one transaction: the cron
      // worker never observes a committed runnable job. The ledger SQL is intact.
      return run(psqlBin, [...args, '-f', '-'], {
        env,
        input: `BEGIN;
${bytes.toString('utf8')}
SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'baci-connector-retention';
COMMIT;`,
      });
    }
    return run(psqlBin, [...args, '-f', sqlPath], { env });
  };
}
