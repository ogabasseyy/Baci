import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

test('refuses stale dependencies instead of implicitly reinstalling during tests', () => {
  const config = parse(
    readFileSync(
      new URL('../../../pnpm-workspace.yaml', import.meta.url),
      'utf8'
    )
  );

  assert.equal(config.verifyDepsBeforeRun, 'error');
});
