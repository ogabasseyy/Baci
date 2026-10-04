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
      // The historical migration must remain identical to the production ledger.
      // Install the real extension, but do not launch background jobs in a replay.
      await run(
        psqlBin,
        [...args, '-c', "ALTER SYSTEM SET cron.launch_active_jobs = 'off'"],
        { env }
      );
      await run(
        psqlBin,
        [...args, '-c', 'SELECT pg_reload_conf(); SELECT pg_sleep(0.1);'],
        { env }
      );
      await run(
        psqlBin,
        [
          ...args,
          '-c',
          `DO $$ BEGIN
        IF current_setting('cron.launch_active_jobs') <> 'off' THEN
          RAISE EXCEPTION 'Replay cron execution must be disabled';
        END IF;
      END $$; CREATE EXTENSION IF NOT EXISTS pg_cron;`,
        ],
        { env }
      );
    }
    return run(psqlBin, [...args, '-f', sqlPath], { env });
  };
}
