import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ciGateFailures, releaseGuardFailures, RELEASE_GUARD_STEP, storeSecretsUsed } from './storefront-release-gate-steps.mjs';

const GUARD = `          set -euo pipefail
          if ! git merge-base --is-ancestor "$RELEASE_SHA" refs/remotes/origin/main; then
            echo '::error::not on main' >&2
            exit 1
          fi
`;

function release({ between = '', extraJob = '', guard = GUARD } = {}) {
  return `name: Release
jobs:
  ship:
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
${between}      - name: ${RELEASE_GUARD_STEP}
        env:
          RELEASE_SHA: \${{ github.sha }}
        run: |
${guard}      - name: Ship
        run: fastlane release
${extraJob}`;
}

test('a release job with the guard right after checkout passes', () => {
  assert.deepEqual(releaseGuardFailures('release.yml', release(), 'ship'), []);
});

test('an unnamed step between checkout and the guard fails the gate', () => {
  const between = '      - run: git update-ref refs/remotes/origin/main "$GITHUB_SHA"\n';
  assert.equal(releaseGuardFailures('release.yml', release({ between }), 'ship').length, 1);
  const uses = '      - uses: ./.github/actions/anything\n';
  assert.equal(releaseGuardFailures('release.yml', release({ between: uses }), 'ship').length, 1);
});

test('a second job in a gated release workflow fails the gate', () => {
  const extraJob = '  sneaky:\n    steps:\n      - run: fastlane release\n';
  const failures = releaseGuardFailures('release.yml', release({ extraJob }), 'ship');
  assert.equal(failures.length, 1);
  assert.match(failures[0], /only job/);
});

test('store secrets are every secret except the token and public client config', () => {
  const text = 'a: ${{ secrets.ASC_API_KEY_ID }}\nb: ${{ secrets.GITHUB_TOKEN }}\nc: ${{ secrets.EXPO_PUBLIC_X }}\nd: ${{ secrets.ASC_API_KEY_ID }}\ne: ${{ secrets.NEXT_PUBLIC_Y }}\nf: ${{ secrets.SENTRY_AUTH_TOKEN }}';
  assert.deepEqual(storeSecretsUsed(text), ['ASC_API_KEY_ID', 'SENTRY_AUTH_TOKEN']);
  assert.deepEqual(storeSecretsUsed('run: echo hi'), []);
});

test('a neutered on-main guard fails the gate', () => {
  const neutered = {
    'kept in a comment': GUARD.replace('if ! git', '# if ! git'),
    'swallowed with || true': GUARD.replace('refs/remotes/origin/main; then', 'refs/remotes/origin/main || true; then'),
    'bare command': '          set -euo pipefail\n          git merge-base --is-ancestor "$RELEASE_SHA" refs/remotes/origin/main\n',
    'exit 0 in the block': GUARD.replace('exit 1', 'exit 0'),
    'exit outside the block': GUARD.replace('            exit 1\n          fi\n', '          fi\n          exit 1\n'),
    'main rewritten first': GUARD.replace('          if !', '          git update-ref refs/remotes/origin/main "$RELEASE_SHA"\n          if !'),
    'main rewritten after': `${GUARD}          git update-ref refs/remotes/origin/main "$RELEASE_SHA"\n`,
    'no pipefail': GUARD.replace('set -euo pipefail', 'set -u'),
  };
  for (const [label, guard] of Object.entries(neutered)) {
    assert.notEqual(guard, GUARD, label);
    const failures = releaseGuardFailures('release.yml', release({ guard }), 'ship');
    assert.equal(failures.length, 1, label);
    assert.match(failures[0], /must refuse a RELEASE_SHA/, label);
  }
});

const CI_WITH = (run) => `jobs:
  changes:
    steps:
      - name: Test storefront release gate
        ${run}
`;

test('the CI gate command may not swallow a failure', () => {
  const ok = ciGateFailures('ci.yml', CI_WITH('run: node --test a.test.mjs'), ['a.test.mjs']);
  assert.deepEqual(ok, []);
  for (const run of ['run: node --test a.test.mjs || true', 'run: node --test a.test.mjs; true', 'run: node --test a.test.mjs | cat', 'run: node --test a.test.mjs &']) {
    assert.equal(ciGateFailures('ci.yml', CI_WITH(run), ['a.test.mjs']).length, 1, run);
  }
});

test('quoted keys and bracket notation do not hide a store secret or a guard condition', () => {
  assert.deepEqual(storeSecretsUsed("env:\n  K: ${{ secrets['ASC_KEY'] }}\n  J: ${{ secrets[\"PLAY_JSON\"] }}"), ['ASC_KEY', 'PLAY_JSON']);
});

test('a quoted if or continue-on-error key on the guard step fails the gate', () => {
  for (const key of ['"if": false', "'continue-on-error': true", '"continue-on-error": true']) {
    const text = release().replace(`      - name: ${RELEASE_GUARD_STEP}\n`, `      - name: ${RELEASE_GUARD_STEP}\n        ${key}\n`);
    assert.equal(releaseGuardFailures('release.yml', text, 'ship').length, 1, key);
  }
});
