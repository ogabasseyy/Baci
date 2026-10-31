import { replayRegistry } from './replay-registry';
import { LEGACY_PENDING_SOURCE_BLOCKS } from './supabase-history-replay-legacy-pending-sources';

const byFilename = (left: string, right: string): number => {
  const l = left.split(' ')[1] ?? '';
  const r = right.split(' ')[1] ?? '';
  if (l < r) return -1;
  if (l > r) return 1;
  return 0;
};

/**
 * The manifest's pending `<sha256> <filename>` rows: the frozen pre-registry
 * blocks plus every registry `pending-sources.txt`, sorted by migration
 * filename (a stable sort, so the result does not depend on block order).
 */
export function buildPendingReplaySourceRows(
  registryDirectory: string = replayRegistry.directory
): string {
  return [
    ...LEGACY_PENDING_SOURCE_BLOCKS.flatMap((block) =>
      block.trim().split('\n')
    ),
    ...replayRegistry.readSourceRows('pending-sources.txt', registryDirectory),
  ]
    .sort(byFilename)
    .join('\n');
}
