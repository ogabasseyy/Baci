import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatchFailures, readDispatchTargets } from './storefront-release-gate-dispatch.mjs';

const IOS = '.github/workflows/ios-storefront-release.yml';
const ANDROID = '.github/workflows/android-storefront-release.yml';
const GATED = [IOS, ANDROID];

test('reads the target of each gh workflow run, REST dispatch and github-script dispatch', () => {
  const cases = {
    'run: gh workflow run ios-storefront-release.yml --ref main': ['ios-storefront-release.yml'],
    'run: gh workflow run --ref main -f a=b ios-storefront-release.yml': ['ios-storefront-release.yml'],
    'run: gh  workflow  run "ios-storefront-release.yml" -f build_number=9': ['ios-storefront-release.yml'],
    'run: gh workflow run --ref=main -R o/r --json security.yml': ['security.yml'],
    'run: |\n  gh workflow run \\\n    --ref main \\\n    security.yml\n': ['security.yml'],
    'run: gh workflow run security.yml && gh workflow run muse-review-selftest.yml': [
      'security.yml',
      'muse-review-selftest.yml',
    ],
    'url: /repos/o/r/actions/workflows/ios-storefront-release.yml/dispatches': ['ios-storefront-release.yml'],
    "script: |\n  await github.rest.actions.createWorkflowDispatch({\n    workflow_id: 'ios-storefront-release.yml',\n  });\n":
      ['ios-storefront-release.yml'],
    'run: gh workflow run security.yml\nnotes: ios-storefront-release.yml': ['security.yml'],
    '# gh workflow run "Anything at all"\nrun: echo ok': [],
    'run: gh workflow list': [],
  };
  for (const [text, targets] of Object.entries(cases)) {
    assert.deepEqual(readDispatchTargets(text), targets, text);
  }
});

test('a workflow that dispatches a gated workflow by file name fails', () => {
  assert.deepEqual(dispatchFailures('nightly.yml', 'run: gh workflow run ios-storefront-release.yml', GATED), [
    `nightly.yml dispatches the gated ${IOS}`,
  ]);
  assert.deepEqual(
    dispatchFailures('nightly.yml', 'url: repos/o/r/actions/workflows/android-storefront-release.yml/dispatches', GATED),
    [`nightly.yml dispatches the gated ${ANDROID}`]
  );
  assert.deepEqual(dispatchFailures('pin.yml', 'run: gh workflow run security.yml --ref "$branch"', GATED), []);
});

test('fails closed on a dispatch target it cannot resolve to a workflow file name', () => {
  for (const text of [
    'run: gh workflow run "iOS Storefront Production Release" --ref main',
    'run: gh workflow run Android --ref main',
    'run: gh workflow run 123456 --ref main',
    'run: gh workflow run "$WF"',
    'run: gh workflow run ${{ env.WORKFLOW }}',
    'run: gh workflow run --ref main',
    'run: gh api -X POST repos/o/r/actions/workflows/123456/dispatches',
    'run: gh api -X POST "repos/o/r/actions/workflows/${WF}/dispatches"',
    "script: github.rest.actions.createWorkflowDispatch({ owner, repo, workflow_id: process.env.WF, ref: 'main' })",
    'script: github.rest.actions.createWorkflowDispatch(params)',
  ]) {
    const failures = dispatchFailures('train.yml', text, GATED);
    assert.equal(failures.length, 1, text);
    assert.match(failures[0], /^train\.yml starts a workflow the storefront release gate cannot identify/, text);
  }
});
