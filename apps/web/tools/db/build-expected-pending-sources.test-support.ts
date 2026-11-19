import { EXPECTED_LEGACY_PENDING_SOURCES } from './expected-legacy-pending-sources.test-support';
import { mergePendingReplaySourceRows } from './merge-pending-replay-source-rows';
import { replayRegistry } from './replay-registry';

type ExpectedPendingSource = {
  repositoryPath: string;
  sha256: string;
};

const MIGRATIONS = 'supabase/migrations/';

function toRow({ repositoryPath, sha256 }: ExpectedPendingSource): string {
  if (!repositoryPath.startsWith(MIGRATIONS)) {
    throw new Error(
      `Expected pending source outside ${MIGRATIONS}: ${repositoryPath}`
    );
  }
  return `${sha256} ${repositoryPath.slice(MIGRATIONS.length)}`;
}

/**
 * The independent expected pending-source inventory the manifest is checked
 * against: the frozen pre-registry entries plus every registry
 * `expected-pending-sources.txt`, merged with the same ordering and
 * de-duplication rule as the manifest rows (merge-pending-replay-source-rows.ts).
 */
export function buildExpectedPendingSources(
  registryDirectory: string = replayRegistry.directory
): ExpectedPendingSource[] {
  return mergePendingReplaySourceRows(
    EXPECTED_LEGACY_PENDING_SOURCES.map(toRow),
    replayRegistry.readSourceRows(
      'expected-pending-sources.txt',
      registryDirectory
    )
  ).map((row) => ({
    repositoryPath: `${MIGRATIONS}${row.slice(65)}`,
    sha256: row.slice(0, 64),
  }));
}
