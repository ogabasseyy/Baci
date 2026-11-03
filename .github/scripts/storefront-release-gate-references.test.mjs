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
