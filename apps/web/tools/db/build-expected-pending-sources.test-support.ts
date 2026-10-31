import { EXPECTED_LEGACY_PENDING_SOURCES } from './expected-legacy-pending-sources.test-support';
import { replayRegistry } from './replay-registry';

type ExpectedPendingSource = {
  repositoryPath: string;
  sha256: string;
};

/**
 * The independent expected pending-source inventory the manifest is checked
 * against: the frozen pre-registry entries plus every registry
 * `expected-pending-sources.txt`, sorted by repository path and de-duplicated
 * (first occurrence wins), exactly as the hand-listed aggregator did.
 */
export function buildExpectedPendingSources(
  registryDirectory: string = replayRegistry.directory
): ExpectedPendingSource[] {
  const registered = replayRegistry
    .readSourceRows('expected-pending-sources.txt', registryDirectory)
    .map((row) => ({
      repositoryPath: `supabase/migrations/${row.slice(65)}`,
      sha256: row.slice(0, 64),
    }));
  return [...EXPECTED_LEGACY_PENDING_SOURCES, ...registered]
    .sort((left, right) =>
      left.repositoryPath.localeCompare(right.repositoryPath)
    )
    .filter(
      (source, index, sources) =>
        sources.findIndex(
          (candidate) => candidate.repositoryPath === source.repositoryPath
        ) === index
    );
}
