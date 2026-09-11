import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  new URL('./seal-source.sh', import.meta.url),
  'utf8'
);

test('rejects a structurally valid but byte-noncanonical manifest before sealing', () => {
  const root = mkdtempSync(join(tmpdir(), 'baci-cwv-noncanonical-manifest-'));
  const manifest = join(root, 'manifest.json');
  const canonicalManifest = {
    authority: {
      deploymentMarker: 'test',
      deploymentRunAttempt: 1,
      deploymentRunId: 1,
      implementationBaseSha: 'a'.repeat(40),
      normativeContractPath: 'contract.json',
      normativeContractSha256: 'b'.repeat(64),
    },
    baseSha: 'c'.repeat(40),
    entries: [],
    mergeSha: 'd'.repeat(40),
    policyCanonicalSha256: 'e'.repeat(64),
    policyFileSha256: 'f'.repeat(64),
    prNumber: 3353,
    reviewedHeadSha: '1'.repeat(40),
    schemaVersion: 1,
    sourceArchive: {
      entries: [
        {
          blobSha256: '2'.repeat(64),
          mode: '100644',
          path: 'infra/cwv-runner/example.txt',
        },
      ],
      prefix: 'infra/cwv-runner/',
    },
  };
  const canonicalManifestFunction = source.slice(
    source.indexOf('canonical_manifest() {'),
    source.indexOf('\nmanifest_rows() {')
  );
  const script = [
    'set -o pipefail',
    'JQ=/usr/bin/jq',
    'PERL=/usr/bin/perl',
    'fail() { printf \'%s\\n\' "seal-source: $*" >&2; exit 1; }',
    canonicalManifestFunction,
    `canonical_manifest ${JSON.stringify(manifest)} d${'d'.repeat(39)} final`,
  ].join('\n');
  writeFileSync(manifest, `${JSON.stringify(canonicalManifest, null, 2)}\n`, {
    mode: 0o600,
  });
  try {
    const result = spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /manifest is not canonical schema-v1 JSON/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
