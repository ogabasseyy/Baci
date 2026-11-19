import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('builder fixture labels satisfy the shared Node contract', () => {
  const contract = resolve(
    process.cwd(),
    '../../.github/scripts/ci-builder-container-labels.test.mjs'
  );
  expect(() =>
    execFileSync(process.execPath, ['--test', contract])
  ).not.toThrow();
});
