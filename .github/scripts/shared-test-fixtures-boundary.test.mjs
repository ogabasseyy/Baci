import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  collectSourceFiles,
  findFixturePatternOffenders,
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
  // Emitted under both the link path and the resolved target path.
  assert.deepEqual(findFixtureImportOffenders([dir]).sort(), [
    join(realpathSync(dir), 'build/hidden.ts'),
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
  assert.ok(offenders.includes(join(dir, 'src/feature/helper.ts')));
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

test('classifies a linked directory by its resolved target path', async () => {
  const { symlinkSync } = await import('node:fs');
  const dir = fixtureDir({
    '__tests__/helper.ts':
      "import { f } from '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const x = f;\n",
  });
  symlinkSync(join(dir, '__tests__'), join(dir, 'prod-link'));
  const files = collectSourceFiles([dir]);
  assert.ok(files.includes(join(dir, '__tests__/helper.ts')));
  assert.ok(files.includes(join(dir, 'prod-link/helper.ts')));
  // The production-named link path is classified as production, so
  // its fixture import is flagged even though the target is exempt.
  assert.ok(
    findFixtureImportOffenders([dir]).includes(join(dir, 'prod-link/helper.ts'))
  );
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

test('retains typed constant fixture specifiers in runner configs', () => {
  const dir = fixtureDir({
    'vitest.config.ts':
      "const specifier: string = '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const load = () => import(specifier);\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [
    join(dir, 'vitest.config.ts'),
  ]);
});

test('folds static template-literal specifiers', () => {
  const dir = fixtureDir({
    'tpl.ts':
      'const specifier = `@baci/shared/test-fixt` + `ures/piggyvest-purchase`;\nexport const load = () => import(specifier);\n',
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [join(dir, 'tpl.ts')]);
});

test('retains comment-prefixed fixture calls in runner configs', () => {
  const dir = fixtureDir({
    'vitest.config.ts':
      "const f = require(/* fixture */ '@baci/shared/test-fixtures/piggyvest-purchase');\nexport const cfg = f;\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [
    join(dir, 'vitest.config.ts'),
  ]);
});

test('flags comment-separated static and dynamic config imports', () => {
  const dir = fixtureDir({
    'vitest.config.ts':
      "import { f } from /* ! */ '@baci/shared/test-fixtures/piggyvest-purchase';\nexport const load = () => import // !\n  ('@baci/shared/test-fixtures/piggyvest-schedule');\nexport const cfg = [f, load];\n",
  });
  assert.deepEqual(findFixtureImportOffenders([dir]), [
    join(dir, 'vitest.config.ts'),
  ]);
});
