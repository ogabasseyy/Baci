import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRemediationStatusFiles } from './remediation-status-files.mjs';

describe('parseRemediationStatusFiles', () => {
  it('returns both sides of a renamed file and ordinary changed files', () => {
    assert.deepEqual(
      parseRemediationStatusFiles(
        ' M src/current.mjs\nR  src/old.mjs -> src/new.mjs\n'
      ),
      ['src/current.mjs', 'src/old.mjs', 'src/new.mjs']
    );
  });

  it('returns no files for an empty status', () => {
    assert.deepEqual(parseRemediationStatusFiles(''), []);
  });
});
