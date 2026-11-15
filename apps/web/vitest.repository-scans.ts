/**
 * Whole-repository scan tests (relative to apps/web). Each one reads every
 * tracked source file, and the event-pipeline scan also reads historical blobs
 * through `git cat-file`.
 *
 * Why they are listed: in CI they run in their own job, "Quality Gate -
 * Repository Scans", with a full-blob checkout. Inside "Quality Gate - Test"
 * (a `blob:none` partial clone) every historical blob was a separate lazy
 * fetch, so the event-pipeline scan took 26-35 min instead of ~3 min and hit
 * its 35-min limit on PR #4218 (CI run 43719412475).
 *
 * The CI test and web shard jobs set BACI_VITEST_EXCLUDE_REPOSITORY_SCANS=1 so
 * they skip these files; the scans job and local runs (variable unset) keep
 * running them. tests/vitest-projects/repository-scans.test.ts fails when an
 * entry no longer exists, so a rename cannot silently drop a scan out of CI.
 */
export const REPOSITORY_SCAN_TEST_FILES: readonly string[] = [
  'tools/events/verify-event-pipeline-boundaries.live.test.ts',
  'tools/events/verify-analytics-delivery-authority.repository.test.ts',
];

export const EXCLUDE_REPOSITORY_SCANS_ENV =
  'BACI_VITEST_EXCLUDE_REPOSITORY_SCANS';

/** The scan files to exclude from this run: all of them when the CI variable is "1", else none. */
export function repositoryScanExcludes(
  env: Record<string, string | undefined> = process.env
): string[] {
  return env[EXCLUDE_REPOSITORY_SCANS_ENV] === '1'
    ? [...REPOSITORY_SCAN_TEST_FILES]
    : [];
}
