import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  findFixtureImportOffenders,
  isTestFile,
  isTestHelper,
} from './shared-test-fixtures-boundary.ts';

function fixtureDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'fixture-boundary-'));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

test('test files and helpers keep their exemptions', () => {
  assert.equal(isTestFile('/repo/foo.test.ts'), true);
  assert.equal(isTestFile('/repo/foo.ts'), false);
  assert.equal(isTestHelper('/repo/order-test-utils.ts'), true);
  assert.equal(isTestHelper('/repo/order-helper.ts'), false);
});

test('classifies .test-fixtures modules as test files', () => {
  const dir = fixtureDir({
    'route.test-fixtures.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const x = f;\n",
    'prod.ts':
      "import { h } from './route.test-fixtures';\nexport const y = h;\n",
    'data.ts':
      "import data from '../test-fixtures/expected.json';\nexport const z = data;\n",
  });
  assert.equal(isTestFile(join(dir, 'route.test-fixtures.ts')), true);
  assert.deepEqual(findFixtureImportOffenders([dir]).sort(), [
    join(dir, 'data.ts'),
    join(dir, 'prod.ts'),
  ]);
});

test('does not flag innocuous names containing test- mid-word', () => {
  const dir = fixtureDir({
    'prod.ts':
      "import { a } from './latest-utils';\nimport { b } from './fastest-helper';\nimport { c } from './contest-utils';\nexport const x = [a, b, c];\n",
    'flagged.ts':
      "import { h } from './order-test-utils';\nexport const y = h;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [join(dir, 'flagged.ts')]);
  assert.equal(isTestHelper(join(dir, 'latest-utils.ts')), false);
  assert.equal(isTestHelper(join(dir, 'order-test-utils.ts')), true);
});

test('config exemption is anchored to real config basenames', () => {
  assert.equal(isTestFile('/repo/vitest.config.ts'), true);
  assert.equal(isTestFile('/repo/src/lib/vitest.config.helpers.ts'), false);
  const dir = fixtureDir({
    'src/lib/vitest.config.helpers.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const x = f;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [
    join(dir, 'src/lib/vitest.config.helpers.ts'),
  ]);
});

test('flags split-literal fixture specifiers and config resolver calls', () => {
  const dir = fixtureDir({
    'prod.ts':
      "const s = '@baci/shared/test-' + 'fixtures/piggyvest-purchase';\nexport const load = () => import(s);\n",
    'vitest.config.ts':
      "const sharedRequire = createRequire(import.meta.url);\nconst f = sharedRequire('@baci/shared/test-fixtures/piggyvest-schedule');\nexport const cfg = f;\n",
    'jest.config.ts':
      "import {\n  purchaseFixture\n} from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const cfg = purchaseFixture;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]).sort(), [
    join(dir, 'jest.config.ts'),
    join(dir, 'prod.ts'),
    join(dir, 'vitest.config.ts'),
  ]);
});

test('detects nested prefixes, escaped literals, and arbitrary splits', () => {
  const dir = fixtureDir({
    'nested.ts':
      "const root = '../test-fixtures/piggyvest/';\nexport const load = (n: string) => import(root + n);\n",
    'escaped.ts':
      "export const load = () => import('@baci/shared/test\\x2dfixtures/piggyvest-purchase');\n",
    'split.ts':
      "const specifier = '@baci/shared/test-fixt' + 'ures/piggyvest-purchase';\nexport const load = () => import(specifier);\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]).sort(), [
    join(dir, 'escaped.ts'),
    join(dir, 'nested.ts'),
    join(dir, 'split.ts'),
  ]);
});

test('folds comment-separated literals; regex literals stay unflagged', () => {
  const dir = fixtureDir({
    'split.ts':
      "const specifier = '@baci/shared/test-fixt' /* split */ + 'ures/piggyvest-purchase';\nexport const load = () => import(specifier);\n",
    'regex.ts':
      "export const re = /test-fixtures\\//;\nexport const digit = 'a\\\\d';\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [join(dir, 'split.ts')]);
});

test('detects line continuations and no-space concatenations', () => {
  const dir = fixtureDir({
    'cont.ts':
      "export const load = () => import('@baci/shared/test\\\n-fixtures/piggyvest-purchase');\n",
    'nospace.ts':
      "const s = '@baci/shared/test-fixt'+'ures/piggyvest-purchase';\nexport const load = () => import(s);\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]).sort(), [
    join(dir, 'cont.ts'),
    join(dir, 'nospace.ts'),
  ]);
});

test('classifies symlinked files by their resolved target', async () => {
  const { symlinkSync } = await import('node:fs');
  const dir = fixtureDir({
    'src/prod.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const x = f;\n",
  });
  symlinkSync(join(dir, 'src/prod.ts'), join(dir, 'helper.test.ts'));
  assert.deepEqual(findFixtureImportOffenders([dir]).sort(), [
    join(realpathSync(dir), 'src/prod.ts'),
    join(dir, 'src/prod.ts'),
  ]);
});
