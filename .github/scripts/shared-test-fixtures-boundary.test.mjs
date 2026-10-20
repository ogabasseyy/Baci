import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  collectSourceFiles,
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

test('emits the same real directory under a second logical path', async () => {
  const { symlinkSync } = await import('node:fs');
  const dir = fixtureDir({
    '__tests__/helper.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const x = f;\n",
  });
  symlinkSync(join(dir, '__tests__'), join(dir, 'prod-link'));
  const files = collectSourceFiles([dir]);
  assert.ok(files.includes(join(dir, 'prod-link/helper.ts')));
});

test('flags template prefixes, multiline config calls, helper directories', () => {
  const dir = fixtureDir({
    'tpl.ts':
      'const load = (name: string) => import(`@baci/shared/test-fixtures/${name}`);\nexport const x = load;\n',
    'prod.ts':
      "import { h } from '@/test-support/find-host-element';\nexport const y = h;\n",
    'vitest.workspace.ts':
      "const alias = '../../packages/shared/src/test-fixtures/builder-ai-edit.ts';\nexport const cfg = alias;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]).sort(), [
    join(dir, 'prod.ts'),
    join(dir, 'tpl.ts'),
  ]);
});

test('retains multiline runner-config resolver calls', () => {
  const dir = fixtureDir({
    'vitest.config.ts':
      "const sharedRequire = createRequire(import.meta.url);\nconst f = sharedRequire(\n  '@baci/shared/test-fixtures/piggyvest-schedule'\n);\nexport const cfg = f;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [
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

test('config const assignments retained; path aliases stay exempt', () => {
  const dir = fixtureDir({
    'vitest.config.ts':
      "const specifier = '@baci/shared/test-fixt' + 'ures/piggyvest-purchase';\nconst alias = path.resolve('../../packages/shared/src/test-fixtures/builder-ai-edit.ts');\nexport const load = () => import(specifier);\nexport const cfg = alias;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [
    join(dir, 'vitest.config.ts'),
  ]);
  const clean = fixtureDir({
    'vitest.config.ts':
      "const alias = path.resolve('../../packages/shared/src/test-fixtures/builder-ai-edit.ts');\nexport const cfg = alias;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([clean]), []);
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

test('retains typed constant fixture specifiers in runner configs', () => {
  const dir = fixtureDir({
    'vitest.config.ts':
      "const specifier: string = '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const load = () => import(specifier);\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [
    join(dir, 'vitest.config.ts'),
  ]);
});
