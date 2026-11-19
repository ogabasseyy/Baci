import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scriptInvocations } from './storefront-release-gate-scripts.mjs';

const reader = (files) => (file) => files[file];
const manifest = (scripts) => JSON.stringify({ scripts });
const FILES = {
  'package.json': manifest({ release: 'pnpm --filter @baci/mobile-storefront ship', lint: 'biome check .' }),
  'apps/mobile-storefront/package.json': manifest({ ship: 'bash scripts/up.sh', preship: 'echo pre', postship: 'echo post', test: 'jest' }),
  'apps/mobile-storefront/Makefile': 'ship:\n\teas build\n',
  Makefile: 'all:\n\techo root\n',
};

function bodies(source, directories = [], files = FILES) {
  const { bodies: found, missing } = scriptInvocations(source, directories, reader(files));
  return { texts: found.map((body) => body.text.trim()), directories: found.map((body) => body.directory), missing };
}

test('a root script is read with its own directory', () => {
  const { texts, directories, missing } = bodies('run: pnpm release');
  assert.deepEqual(texts, ['pnpm --filter @baci/mobile-storefront ship']);
  assert.deepEqual(directories, ['']);
  assert.deepEqual(missing, []);
});

test('a storefront script brings its pre and post hooks and its package directory', () => {
  const { texts, directories } = bodies('run: pnpm --filter @baci/mobile-storefront run ship');
  assert.deepEqual(texts, ['echo pre', 'bash scripts/up.sh', 'echo post']);
  assert.deepEqual(new Set(directories), new Set(['apps/mobile-storefront']));
});

test('npm only runs scripts through run or its lifecycle names', () => {
  assert.deepEqual(bodies('run: npm run ship --prefix apps/mobile-storefront').missing, []);
  assert.deepEqual(bodies('run: npm test --prefix apps/mobile-storefront').texts, ['jest']);
  assert.deepEqual(bodies('run: npm install').texts, []);
});

test('flags with values and inline values are not mistaken for script names', () => {
  assert.deepEqual(bodies('run: pnpm --filter=@baci/mobile-storefront ship').missing, []);
  assert.deepEqual(bodies('run: pnpm -F @baci/mobile-storefront ship').texts.includes('bash scripts/up.sh'), true);
  assert.deepEqual(bodies('run: pnpm --dir apps/mobile-storefront ship').texts.includes('bash scripts/up.sh'), true);
});

test('turbo and recursive runs read the storefront script when it exists', () => {
  assert.equal(bodies('run: turbo run ship lint').texts.includes('bash scripts/up.sh'), true);
  assert.equal(bodies('run: pnpm -r ship').texts.includes('bash scripts/up.sh'), true);
  assert.deepEqual(bodies('run: turbo run nothing-here').missing, []);
});

test('make reads the Makefile in the working or -C directory', () => {
  assert.deepEqual(bodies('run: make ship', ['apps/mobile-storefront']).texts, ['ship:\n\teas build']);
  assert.deepEqual(bodies('run: make -C apps/mobile-storefront ship').texts, ['ship:\n\teas build']);
  assert.deepEqual(bodies('run: make all').texts, ['all:\n\techo root']);
});

test('storefront-scoped runs that cannot be resolved are reported, unscoped ones are not', () => {
  assert.deepEqual(bodies('run: pnpm --filter @baci/mobile-storefront gone').missing, ['package script "gone" for apps/mobile-storefront']);
  assert.deepEqual(bodies('run: make -C apps/mobile-storefront gone', [], { 'apps/mobile-storefront/package.json': '{}' }).missing, [
    'Makefile target "gone"',
  ]);
  assert.deepEqual(bodies('run: pnpm gone').missing, []);
  assert.deepEqual(bodies('run: pnpm --filter @baci/web gone').missing, []);
});

test('an unreadable storefront package.json fails closed', () => {
  const { missing } = bodies('run: pnpm --filter @baci/mobile-storefront ship', [], { 'apps/mobile-storefront/package.json': '{' });
  assert.equal(missing.length, 2);
  assert.match(missing[0], /unreadable/);
});

test('package-manager commands that are not scripts are ignored', () => {
  for (const source of ['run: pnpm install --frozen-lockfile', 'run: pnpm exec jest', 'run: pnpm dlx tool', 'run: yarn add x', 'run: bun install']) {
    assert.deepEqual(bodies(source), { texts: [], directories: [], missing: [] }, source);
  }
});

test('a command split by a shell line continuation is read as one command', () => {
  for (const source of [
    'run: |\n  pnpm \\\n    --filter @baci/mobile-storefront run ship',
    'run: |\n  pnpm --filter @baci/mobile-storefront \\\n    ship',
    'run: |\n  npm --prefix apps/mobile-storefront \\\n  run ship',
  ]) {
    assert.ok(bodies(source).texts.includes('bash scripts/up.sh'), source);
  }
});

test('turbo run through pnpm, yarn, npm exec or npx expands the task', () => {
  const files = { ...FILES, 'apps/mobile-storefront/package.json': manifest({ ship: 'fastlane ios release' }) };
  for (const source of [
    'run: pnpm turbo run ship',
    'run: pnpm exec turbo run ship',
    'run: pnpm dlx turbo run ship',
    'run: yarn turbo run ship',
    'run: npx turbo run ship',
    'run: npx --yes turbo run ship',
    'run: pnpm -w exec turbo run ship --filter=@baci/mobile-storefront',
  ]) {
    assert.deepEqual(bodies(source, [], files).texts, ['fastlane ios release'], source);
  }
  assert.deepEqual(bodies('run: pnpm exec jest', [], files).texts, []);
});
