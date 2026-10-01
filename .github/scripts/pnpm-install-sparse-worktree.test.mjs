import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./pnpm-install-sparse-worktree.sh', import.meta.url),
  'utf8'
);

test('scopes unused-patch tolerance to sparse worktree installs only', () => {
  assert.match(source, /pnpm-install-with-retry\.sh/);
  assert.match(source, /--config\.allowUnusedPatches=true/);
});
