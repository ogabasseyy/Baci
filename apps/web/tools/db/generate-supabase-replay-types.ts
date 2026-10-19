import { runSupabaseReplayStage } from './run-supabase-replay-stage';
import type { ReplayCommand } from './supabase-history-replay-types';

export function generateSupabaseReplayTypes(
  run: ReplayCommand,
  databaseUrl: string
) {
  return runSupabaseReplayStage('gen types', () =>
    run('supabase', [
      'gen',
      'types',
      'typescript',
      '--db-url',
      databaseUrl,
      '--schema',
      'public',
    ])
  );
}
