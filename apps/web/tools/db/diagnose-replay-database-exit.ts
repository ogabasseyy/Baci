import type { ReplayCommand } from './supabase-history-replay-types';

/** Return only a fixed diagnostic class; container logs can contain secrets. */
export async function diagnoseReplayDatabaseExit(
  container: string,
  run: ReplayCommand
): Promise<string | null> {
  if (!/^supabase_db_[a-z0-9][a-z0-9_-]{2,62}$/.test(container)) return null;
  try {
    const logs = await run('docker', ['logs', '--tail', '500', container]);
    const signal =
      /\bLOG:\s+server process \(PID \d+\) was terminated by signal (6|9|11)\b/.exec(
        `${logs.stdout}\n${logs.stderr}`
      )?.[1];
    return signal ? `database-backend-signal-${signal}` : null;
  } catch {
    return null;
  }
}
