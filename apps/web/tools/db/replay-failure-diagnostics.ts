import { diagnoseReplayDatabaseExit } from './diagnose-replay-database-exit';
import type { ReplayProjectCleanupResult } from './replay-project-ownership';
import type { ReplayCommand } from './supabase-history-replay-types';
import type { ExpectedSupabaseReplayResources } from './supabase-replay-expected-resources';

export async function withDatabaseExitDiagnostic(
  failure: unknown,
  expected: ExpectedSupabaseReplayResources,
  run: ReplayCommand
): Promise<unknown> {
  if (
    !(failure instanceof Error) ||
    !failure.message.includes('reason=connection-lost')
  ) {
    return failure;
  }
  const database = expected.containers.find((item) =>
    item.name.startsWith('supabase_db_')
  );
  if (!database) return failure;
  const diagnostic = await diagnoseReplayDatabaseExit(database.name, run);
  if (!diagnostic) return failure;
  return new Error(`${failure.message} (diagnostic=${diagnostic})`, {
    cause: failure,
  });
}

export function withCleanupDiagnostics(
  failure: unknown,
  cleanup: ReplayProjectCleanupResult | undefined
): unknown {
  if (cleanup?.resourceReadiness !== 'anomalous') return failure;
  const primary =
    failure instanceof Error ? failure : new Error('Supabase replay failed');
  return Object.assign(new Error(primary.message, { cause: primary }), {
    name: primary.name,
    replayDiagnostics: { cleanup },
  });
}
