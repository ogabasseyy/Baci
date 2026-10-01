import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./quality-gate-missing-tests.sh', import.meta.url),
  'utf8'
);

test('audits staged and untracked source files', () => {
  assert.match(source, /git diff --name-only --cached/);
  assert.match(source, /git ls-files --others --exclude-standard/);
});

test('skips Next.js route files and colocated tests', () => {
  assert.match(source, /\*\.test\.ts/);
  assert.match(source, /page\.tsx/);
  assert.match(source, /route\.ts/);
});
