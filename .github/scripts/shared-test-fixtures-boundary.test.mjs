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

test('flags runner config files importing shared fixtures', () => {
  const dir = fixtureDir({
    'metro.config.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const x = f;\n",
    'vitest.config.ts':
      "import { h } from './order-test-utils';\nexport const y = h;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [
    join(dir, 'metro.config.ts'),
  ]);
});

test('test-runner configs may register fixture aliases', () => {
  const dir = fixtureDir({
    'vitest.config.ts':
      "const alias = '../../packages/shared/src/test-fixtures/builder-ai-edit.ts';\nexport const x = alias;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), []);
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

test('follows extensionless in-root file symlinks to source targets', async () => {
  const { symlinkSync } = await import('node:fs');
  const dir = fixtureDir({
    'src/feature/helper.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const x = f;\n",
  });
  symlinkSync(join(dir, 'src/feature/helper.ts'), join(dir, 'linked-helper'));
  const offenders = findFixtureImportOffenders([dir]);
  assert.ok(offenders.includes(join(dir, 'linked-helper')));
});

test('nested files reusing a config basename are not exempt', () => {
  const dir = fixtureDir({
    'vitest.config.ts':
      "const alias = './test-fixtures/x';\nexport const a = alias;\n",
    'src/lib/vitest.config.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const x = f;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [
    join(dir, 'src/lib/vitest.config.ts'),
  ]);
});

test('root runner config importing a fixture is flagged', () => {
  const dir = fixtureDir({
    'vitest.config.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nconst alias = './test-fixtures/x';\nexport const cfg = [f, alias];\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [
    join(dir, 'vitest.config.ts'),
  ]);
});

test('flags quoted fixture-tree prefix constants', () => {
  const dir = fixtureDir({
    'prod.ts':
      "const p = '../test-fixtures/' + name;\nexport const load = () => import(p);\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [join(dir, 'prod.ts')]);
});

test('flags production imports of .tests modules', () => {
  const dir = fixtureDir({
    'prod.ts':
      "import { h } from './route.list.tests';\nexport const x = h;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [join(dir, 'prod.ts')]);
});
