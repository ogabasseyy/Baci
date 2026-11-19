import { replayRepository } from './replay-repository-root';
import { replaySqlCheckRegistry } from './replay-sql-check-registry';
import { parseSupabaseReplayArguments } from './supabase-replay-contract';

/**
 * Replay CLI entry: expands `--sql-check-registry <dir>` into the registered
 * `--sql-check` suites, then applies the strict replay argument parser.
 */
export function parseReplayCliArguments(
  argv: readonly string[],
  repositoryRoot: string = replayRepository.root(import.meta.dirname)
): ReturnType<typeof parseSupabaseReplayArguments> {
  return parseSupabaseReplayArguments(
    replaySqlCheckRegistry.expandArguments(argv, repositoryRoot)
  );
}
