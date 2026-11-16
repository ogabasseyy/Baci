// Accept either quote style and an optional trailing comma, so a formatter
// change does not break the refresh; the exactly-one-match guard still fails
// closed on anything ambiguous.
const SNAPSHOT_SHA_PATTERN = /(snapshotSha256:\s*)(['"])[a-f0-9]{64}\2/g;
const ROW_COUNT_PATTERN = /(\browCount:\s*)\d+\b/g;

function replaceExactlyOnce(
  source: string,
  pattern: RegExp,
  replace: (match: string, ...groups: string[]) => string,
  label: string
) {
  const matches = source.match(pattern) ?? [];
  if (matches.length !== 1)
    throw new Error(
      `snapshot test must contain exactly one ${label} expectation (found ${matches.length})`
    );
  return source.replace(pattern, replace);
}

/**
 * Rewrites the expected snapshot digest and row count in the repository
 * snapshot test so it matches a freshly regenerated inventory artifact.
 */
export function updateStorefrontEdgeSnapshotExpectations(
  testSource: string,
  expected: Readonly<{ snapshotSha256: string; rowCount: number }>
) {
  if (!/^[a-f0-9]{64}$/.test(expected.snapshotSha256))
    throw new Error('snapshot digest must be a lowercase sha256 hex string');
  if (!Number.isSafeInteger(expected.rowCount) || expected.rowCount < 0)
    throw new Error('snapshot row count must be a non-negative integer');
  const withDigest = replaceExactlyOnce(
    testSource,
    SNAPSHOT_SHA_PATTERN,
    (_match, prefix, quote) =>
      `${prefix}${quote}${expected.snapshotSha256}${quote}`,
    'snapshotSha256'
  );
  return replaceExactlyOnce(
    withDigest,
    ROW_COUNT_PATTERN,
    (_match, prefix) => `${prefix}${expected.rowCount}`,
    'rowCount'
  );
}
