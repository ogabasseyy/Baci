import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  findFixtureImportOffenders,
  findFixturePatternOffenders,
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

test('flags plainly-named __tests__ helpers importing fixtures', () => {
  const dir = fixtureDir({
    '__tests__/helper.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const x = f;\n",
    '__tests__/real.test.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const y = f;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [
    join(dir, '__tests__/helper.ts'),
  ]);
});

test('follows in-root symlinks and skips out-of-root links', async () => {
  const { symlinkSync } = await import('node:fs');
  // build/ at a scan root is skipped by name; an in-root symlink to it
  // is followed, so its fixture import is still flagged.
  const dir = fixtureDir({
    'build/hidden.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const x = f;\n",
  });
  symlinkSync(join(dir, 'build'), join(dir, 'linked'));
  const outside = fixtureDir({
    'out.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const y = f;\n",
  });
  symlinkSync(outside, join(dir, 'external'));
  assert.deepEqual(findFixtureImportOffenders([dir]), [
    join(dir, 'linked/hidden.ts'),
  ]);
});

test('fixture-pattern-only scan flags direct imports but allows helpers', () => {
  const dir = fixtureDir({
    'tool.ts':
      "import { h } from './order-test-utils';\nexport const x = h;\n",
    'direct.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const y = f;\n",
  });
  assert.deepEqual(findFixturePatternOffenders([dir]), [join(dir, 'direct.ts')]);
});
