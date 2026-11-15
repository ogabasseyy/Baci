const SNAPSHOT_SHA_PATTERN = /(snapshotSha256:\s*')([a-f0-9]{64})(')/g;
const ROW_COUNT_PATTERN = /(\browCount:\s*)(\d+)(,)/g;

function replaceExactlyOnce(
  source: string,
  pattern: RegExp,
  value: string,
  label: string
) {
  const matches = source.match(pattern) ?? [];
  if (matches.length !== 1)
    throw new Error(
      `snapshot test must contain exactly one ${label} expectation (found ${matches.length})`
    );
  return source.replace(
    pattern,
    (_match, prefix: string, _old: string, suffix: string) =>
      `${prefix}${value}${suffix}`
  );
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
    expected.snapshotSha256,
    'snapshotSha256'
  );
  return replaceExactlyOnce(
    withDigest,
    ROW_COUNT_PATTERN,
    String(expected.rowCount),
    'rowCount'
  );
}
