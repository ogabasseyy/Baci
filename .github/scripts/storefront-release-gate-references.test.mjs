import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandReferences } from './storefront-release-gate-references.mjs';

const reader = (files) => (file) => files[file];

test('a referenced script is joined to the file that runs it, transitively', () => {
  const files = {
    '.github/scripts/ship.sh': 'bash .github/scripts/inner.sh\n',
    '.github/scripts/inner.sh': 'bundle exec fastlane ios release\n',
  };
  const { text, missing } = expandReferences('run: bash .github/scripts/ship.sh', reader(files));
  assert.match(text, /fastlane ios release/);
  assert.deepEqual(missing, []);
});

test('a script under working-directory resolves against it', () => {
  const files = { 'apps/mobile-storefront/scripts/up.sh': 'fastlane beta\n' };
  const yaml = 'working-directory: apps/mobile-storefront\nrun: ./scripts/up.sh\n';
  assert.match(expandReferences(yaml, reader(files)).text, /fastlane beta/);
});

test('an unreadable .github script fails closed; other unreadable names are ignored', () => {
  const { missing } = expandReferences('run: bash ./.github/scripts/gone.sh && node tool.js', reader({}));
  assert.deepEqual(missing, ['.github/scripts/gone.sh']);
});

test('self-referencing scripts end and the gate modules are not expanded', () => {
  const files = {
    'a.sh': 'bash b.sh\n',
    'b.sh': 'bash a.sh\n',
    '.github/scripts/storefront-release-gate.mjs': 'fastlane gh workflow run\n',
    'x.test.sh': 'fastlane in a test\n',
  };
  const { text } = expandReferences('bash a.sh\nnode .github/scripts/storefront-release-gate.mjs\nbash x.test.sh', reader(files));
  assert.doesNotMatch(text, /gh workflow run|in a test/);
});

test('words in comment lines of a referenced script are ignored', () => {
  const files = { 's.sh': '# fastlane is used elsewhere\necho hi\n' };
  assert.doesNotMatch(expandReferences('bash s.sh', reader(files)).text, /fastlane/);
});

test('a local composite action or reusable workflow is joined to the file that uses it', () => {
  const files = {
    '.github/actions/ship/action.yml': 'runs:\n  steps:\n    - run: bundle exec fastlane ios release\n',
    '.github/workflows/reusable-ship.yml': 'jobs:\n  j:\n    steps:\n      - run: eas submit\n',
    '.github/actions/outer/action.yaml': 'runs:\n  steps:\n    - uses: ./.github/actions/ship\n',
  };
  for (const [uses, expected] of [
    ['./.github/actions/ship', /fastlane ios release/],
    ['./.github/actions/ship/', /fastlane ios release/],
    ['"./.github/actions/ship"', /fastlane ios release/],
    ['./.github/workflows/reusable-ship.yml', /eas submit/],
    ['./.github/actions/outer', /fastlane ios release/],
  ]) {
    const { text, missing } = expandReferences(`      - uses: ${uses}\n        with:\n          dir: apps/mobile-storefront\n`, reader(files));
    assert.match(text, expected, uses);
    assert.deepEqual(missing, [], uses);
  }
});

test('a local action or workflow that cannot be read fails closed; external uses are ignored', () => {
  const { missing } = expandReferences(
    '- uses: ./.github/actions/gone\n- uses: actions/checkout@v4\n- uses: ./.github/workflows/gone.yml\n',
    reader({})
  );
  assert.deepEqual(missing, ['.github/actions/gone', '.github/workflows/gone.yml']);
});

test('extensionless scripts are followed and an unreadable .github one fails closed', () => {
  const files = {
    'apps/mobile-storefront/scripts/release': 'fastlane ios beta\n',
    'scripts/deploy': 'eas submit\n',
    '.github/scripts/ship': 'bundle exec fastlane android deploy\n',
  };
  for (const [yaml, expected] of [
    ['run: bash apps/mobile-storefront/scripts/release', /fastlane ios beta/],
    ['run: sh -e scripts/deploy\nrun: bash scripts/deploy', /eas submit/],
    ['working-directory: apps/mobile-storefront\nrun: ./scripts/release', /fastlane ios beta/],
    ['run: ./scripts/deploy --prod', /eas submit/],
    ['run: scripts/deploy', /eas submit/],
    ['run: .github/scripts/ship', /fastlane android deploy/],
    ['run: source ./.github/scripts/ship', /fastlane android deploy/],
  ]) {
    assert.match(expandReferences(yaml, reader(files)).text, expected, yaml);
  }
  const { missing } = expandReferences('run: bash .github/scripts/gone && echo bash is fine', reader({}));
  assert.deepEqual(missing, ['.github/scripts/gone']);
  assert.deepEqual(expandReferences('run: echo hello && ./missing-tool', reader({})).missing, []);
});

test('package scripts, turbo tasks and make targets are followed', () => {
  const files = {
    'package.json': JSON.stringify({ scripts: { release: 'pnpm --filter @baci/mobile-storefront ship', other: 'echo hi' } }),
    'apps/mobile-storefront/package.json': JSON.stringify({ scripts: { ship: 'bash scripts/up.sh', upload: 'eas submit', preup: 'echo pre' } }),
    'apps/mobile-storefront/scripts/up.sh': 'fastlane ios release\n',
    Makefile: 'ship:\n\teas build\n',
  };
  for (const [yaml, expected] of [
    ['run: pnpm run release', /fastlane ios release/],
    ['run: pnpm release', /fastlane ios release/],
    ['run: npm run upload --prefix apps/mobile-storefront', /eas submit/],
    ['run: pnpm -C apps/mobile-storefront upload', /eas submit/],
    ['working-directory: apps/mobile-storefront\nrun: yarn upload', /eas submit/],
    ['run: turbo run upload', /eas submit/],
    ['run: pnpm -r run upload', /eas submit/],
    ['run: make ship', /eas build/],
  ]) {
    const { text, missing } = expandReferences(yaml, reader(files));
    assert.match(text, expected, yaml);
    assert.deepEqual(missing, [], yaml);
  }
});

test('a storefront-scoped script run that cannot be resolved fails closed; other runs are ignored', () => {
  const files = { 'apps/mobile-storefront/package.json': '{"scripts":{}}', 'package.json': '{"scripts":{}}' };
  assert.deepEqual(expandReferences('run: pnpm --filter @baci/mobile-storefront ship', reader(files)).missing, [
    'package script "ship" for apps/mobile-storefront',
  ]);
  assert.deepEqual(expandReferences('working-directory: apps/mobile-storefront\nrun: npm run ship', reader(files)).missing, [
    'package script "ship" for apps/mobile-storefront',
  ]);
  assert.equal(expandReferences('run: make -C apps/mobile-storefront ship', reader(files)).missing.length, 1);
  for (const yaml of ['run: pnpm install --frozen-lockfile', 'run: pnpm run lint', 'run: npm ci', 'run: pnpm exec jest']) {
    assert.deepEqual(expandReferences(yaml, reader(files)).missing, [], yaml);
  }
});

test('shell options before a script operand do not hide the script', () => {
  const files = { 'release-helper': 'eas submit\n' };
  for (const yaml of ['run: bash -e release-helper', 'run: sh -eu -x ./release-helper', 'run: bash -o pipefail release-helper']) {
    assert.match(expandReferences(yaml, reader(files)).text, /eas submit/, yaml);
  }
});

test('a script is read from both the working directory and the repository root', () => {
  const files = { 'scripts/release': 'echo harmless\n', 'apps/mobile-storefront/scripts/release': 'fastlane ios release\n' };
  const yaml = 'working-directory: apps/mobile-storefront\nrun: ./scripts/release\n';
  assert.match(expandReferences(yaml, reader(files)).text, /fastlane ios release/);
});

test('a reference chain deeper than the expansion limit fails closed', () => {
  const files = {};
  for (let index = 0; index < 12; index += 1) files[`s${index}.sh`] = `bash s${index + 1}.sh\n`;
  files['s12.sh'] = 'eas submit\n';
  const { missing } = expandReferences('run: bash s0.sh', reader(files));
  assert.equal(missing.length, 1);
  assert.match(missing[0], /deeper than/);
});

test('script bodies from the storefront package keep their scope even when the body never names the app', () => {
  const files = {
    'package.json': JSON.stringify({ scripts: { ship: 'turbo run upload', other: 'echo hi' } }),
    'apps/mobile-storefront/package.json': JSON.stringify({ scripts: { upload: 'eas submit', lint: 'biome check' } }),
    'apps/other/package.json': JSON.stringify({ scripts: { upload: 'eas submit' } }),
  };
  const scoped = expandReferences('run: turbo run upload', reader(files));
  assert.match(scoped.scopedText, /eas submit/);
  assert.doesNotMatch(expandReferences('run: pnpm -C apps/other upload', reader({ ...files, 'package.json': '{}' })).scopedText, /eas submit/);
  assert.doesNotMatch(expandReferences('run: echo hi', reader(files)).scopedText, /eas submit/);
});

test('a working directory given through an env expression resolves to its literal value', () => {
  const files = {
    'package.json': '{"scripts":{}}',
    'apps/mobile-storefront/package.json': JSON.stringify({ scripts: { ship: 'fastlane ios release' } }),
  };
  const yaml = [
    'env:',
    '  WORKING_DIR: apps/mobile-storefront',
    'jobs:',
    '  a:',
    '    steps:',
    '      - working-directory: ${{ env.WORKING_DIR }}',
    '        run: pnpm run ship',
  ].join('\n');
  assert.match(expandReferences(yaml, reader(files)).scopedText, /fastlane ios release/);
});
