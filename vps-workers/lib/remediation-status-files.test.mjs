import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRemediationStatusFiles } from './remediation-status-files.mjs';

describe('parseRemediationStatusFiles', () => {
  it('returns both sides of a renamed file and ordinary changed files', () => {
    assert.deepEqual(
      parseRemediationStatusFiles(
        ' M src/current.mjs\0R  src/new.mjs\0src/old.mjs\0'
      ),
      ['src/current.mjs', 'src/new.mjs', 'src/old.mjs']
    );
  });

  it('preserves tabs and newlines in NUL-delimited paths', () => {
    assert.deepEqual(
      parseRemediationStatusFiles(' M apps/web/src/evil\tname\nfile.ts\0'),
      ['apps/web/src/evil\tname\nfile.ts']
    );
  });

  it('returns no files for an empty status', () => {
    assert.deepEqual(parseRemediationStatusFiles(''), []);
  });
});
