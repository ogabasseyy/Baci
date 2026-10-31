// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UCP_FIXTURE_DIR } from './ucp-fixture-paths';

const PINNED_COMMIT = '9c9d6fce39ffa8bf7cb66309c378b79fb75b5382';

function readManifestCommit(): string {
  return JSON.parse(
    readFileSync(join(UCP_FIXTURE_DIR, 'manifest.json'), 'utf8')
  ).commit;
}

describe('vendored UCP 2026-04-08 schemas', () => {
  it('pin the upstream commit and keep the Apache-2.0 licence', () => {
    expect(readManifestCommit()).toBe(PINNED_COMMIT);
    expect(readFileSync(join(UCP_FIXTURE_DIR, 'SOURCE.md'), 'utf8')).toContain(
      PINNED_COMMIT
    );
    expect(readFileSync(join(UCP_FIXTURE_DIR, 'LICENSE'), 'utf8')).toContain(
      'Apache License'
    );
  });
});
