import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
