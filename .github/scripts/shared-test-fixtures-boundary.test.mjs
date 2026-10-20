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

test('flags package-specifier fixture imports in production files', () => {
  const dir = fixtureDir({
    'prod.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const x = f;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [join(dir, 'prod.ts')]);
});

test('flags production importing test helpers and plain test modules', () => {
  const dir = fixtureDir({
    'a.ts': "import { h } from './order-test-helper';\nexport const x = h;\n",
    'b.ts': "import { t } from './foo.test';\nexport const y = t;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]).sort(), [
    join(dir, 'a.ts'),
    join(dir, 'b.ts'),
  ]);
});

test('scans nested production tools dirs but skips generated dirs', () => {
  const dir = fixtureDir({
    'src/feature/tools/prod.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const x = f;\n",
    'ios/Pods/gen.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const x = f;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [
    join(dir, 'src/feature/tools/prod.ts'),
  ]);
});

test('test files and helpers keep their exemptions', () => {
  assert.equal(isTestFile('/repo/foo.test.ts'), true);
  assert.equal(isTestFile('/repo/foo.ts'), false);
  assert.equal(isTestHelper('/repo/order-test-utils.ts'), true);
  assert.equal(isTestHelper('/repo/order-helper.ts'), false);
});

test('flags production importing a __tests__ helper and nested build sources', () => {
  const dir = fixtureDir({
    'prod.ts':
      "import { h } from '../__tests__/helper';\nexport const x = h;\n",
    'src/feature/build/prod.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const y = f;\n",
    'android/app/build/gen.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const z = f;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]).sort(), [
    join(dir, 'prod.ts'),
    join(dir, 'src/feature/build/prod.ts'),
  ]);
});
