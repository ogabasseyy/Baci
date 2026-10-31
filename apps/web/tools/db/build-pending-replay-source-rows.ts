import { mergePendingReplaySourceRows } from './merge-pending-replay-source-rows';
import { replayRegistry } from './replay-registry';
import { LEGACY_PENDING_SOURCE_BLOCKS } from './supabase-history-replay-legacy-pending-sources';

/**
 * The manifest's pending `<sha256> <filename>` rows: the frozen pre-registry
 * blocks plus every registry `pending-sources.txt`, merged with the rule the
 * expected inventory also uses (see merge-pending-replay-source-rows.ts).
 */
export function buildPendingReplaySourceRows(
  registryDirectory: string = replayRegistry.directory
): string {
  return mergePendingReplaySourceRows(
    LEGACY_PENDING_SOURCE_BLOCKS.flatMap((block) => block.trim().split('\n')),
    replayRegistry.readSourceRows('pending-sources.txt', registryDirectory)
  ).join('\n');
}
