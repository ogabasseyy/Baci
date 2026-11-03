import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseGuardFailures, RELEASE_GUARD_STEP, storeSecretsUsed } from './storefront-release-gate-steps.mjs';

function release({ between = '', extraJob = '' } = {}) {
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
          set -euo pipefail
          git merge-base --is-ancestor "$RELEASE_SHA" refs/remotes/origin/main
      - name: Ship
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
