import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createsReleaseTag, dispatchFailures, readDispatchTargets } from './storefront-release-gate-dispatch.mjs';

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

test('a file that creates a release tag or ref, or a release, fails because tags start the gated workflows', () => {
  for (const text of [
    'run: git tag v999-storefront "$GITHUB_SHA" && git push origin v999-storefront',
    'run: git push origin v12-storefront-ios',
    'run: git push origin "v${N}-storefront"',
    'run: git push --tags',
    'run: git push --follow-tags origin HEAD',
    'run: git push origin --mirror',
    'run: git push origin tag "$TAG"',
    'run: git push origin HEAD:refs/tags/v1-storefront',
    'run: git tag -a v1-storefront -m x',
    'run: gh release create v999-storefront-ios --target main',
    'run: gh release create "$TAG"',
    'run: gh api -X POST repos/o/r/git/refs -f ref=refs/tags/v1-storefront -f sha=abc',
    'run: gh api repos/o/r/git/tags -f tag=v1-storefront',
    "script: await github.rest.git.createRef({ owner, repo, ref: 'refs/tags/v1-storefront', sha })",
    'script: await github.rest.repos.createRelease({ owner, repo, tag_name: tag })',
    'run: curl -X POST https://api.github.com/repos/o/r/releases -d "$body"',
    'uses: softprops/action-gh-release@v2',
    'uses: actions/create-release@v1',
  ]) {
    const failures = dispatchFailures('nightly.yml', text, GATED);
    assert.equal(failures.length, 1, text);
    assert.match(failures[0], /^nightly\.yml creates a release tag, ref or release/, text);
  }
});

test('ordinary git pushes and comments do not count as starting a release', () => {
  for (const text of [
    'run: git push origin HEAD:refs/heads/preview',
    'run: git push origin HEAD',
    '# git tag v1-storefront\nrun: echo ok',
    'run: gh release view v1 --json tagName',
    'run: gh release download v1',
    'run: gh api repos/o/r/releases/latest',
  ]) {
    assert.deepEqual(dispatchFailures('nightly.yml', text, GATED), [], text);
  }
});

test('each github-script dispatch call needs its own literal target', () => {
  const mixed = "github.rest.actions.createWorkflowDispatch(params);\nawait github.rest.actions.createWorkflowDispatch({ workflow_id: 'security.yml' });";
  assert.deepEqual(readDispatchTargets(mixed).sort(), ['', 'security.yml']);
  assert.equal(dispatchFailures('w.yml', mixed, GATED).length, 1);
});

test('pushing a tag through a variable or an explicit ref fails closed', () => {
  for (const line of ['git push origin "$TAG"', 'git push origin $TAG', 'git push origin HEAD:refs/tags/v1-storefront', 'git push origin "${TAG_NAME}"']) {
    assert.equal(createsReleaseTag(`run: ${line}`), true, line);
  }
  assert.equal(createsReleaseTag('run: git push origin main'), false);
});

test('git global options before the subcommand do not hide a tag or push', () => {
  for (const text of [
    'run: git -C . tag v1-storefront',
    'run: git -C "$DIR" push --tags',
    'run: git -c user.name=ci tag -a v1-storefront -m x',
    'run: git --no-pager tag v2',
    'run: git --git-dir=.git push origin v1-storefront',
    'run: git --git-dir .git --work-tree . push --follow-tags',
    'run: git --work-tree=. -c core.x=y -C sub tag v3',
    'run: git -C sub push origin "$TAG"',
  ]) {
    assert.equal(createsReleaseTag(text), true, text);
  }
  for (const text of ['run: git -C sub push origin HEAD', 'run: git --no-pager log -1', 'run: git -c a=b status']) {
    assert.equal(createsReleaseTag(text), false, text);
  }
});
