import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectGateFailures,
  GATE_MARKER,
  GATE_RUNBOOK,
  gitRepository,
  OTA_GUARD_STEP,
  OTA_WORKFLOW,
  parseGateMarker,
  RELEASE_GUARD_STEP,
} from './storefront-release-gate.mjs';
import { readJob, readStep } from './storefront-release-gate-workflows.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const repository = gitRepository(ROOT);
const IOS_RELEASE = '.github/workflows/ios-storefront-release.yml';
const ANDROID_RELEASE = '.github/workflows/android-storefront-release.yml';
const CI = '.github/workflows/ci.yml';
const PIN_SHEET = 'apps/mobile-storefront/components/wallet/WalletPinSheet.tsx';
const PIN_SHEET_SERVER_OFF = 'apps/mobile-storefront/components/wallet/WalletPinSheet.server-off.test.tsx';

// The real repository with some files replaced, added (string) or removed (null).
function withFiles(files) {
  const added = Object.keys(files).filter((file) => files[file] !== null);
  return {
    ...repository,
    readFile: (file) => (Object.hasOwn(files, file) ? (files[file] ?? undefined) : repository.readFile(file)),
    listWorkflows: () => [
      ...new Set([...repository.listWorkflows(), ...added.filter((file) => file.startsWith('.github/workflows/'))]),
    ],
    listActions: () => [
      ...new Set([...repository.listActions(), ...added.filter((file) => file.startsWith('.github/actions/'))]),
    ],
    listTracked: (root) => [...new Set([...repository.listTracked(root), ...added.filter((file) => file.startsWith(`${root}/`))])],
  };
}

test('the repository satisfies the storefront release gate', () => {
  assert.deepEqual(collectGateFailures(repository), []);
});

test('iOS can upload a TestFlight build without submitting it for App Review', () => {
  const workflow = repository.readFile(IOS_RELEASE);
  const job = readJob(workflow, 'build-and-submit');
  const upload = readStep(job, 'Fastlane release').text;
  const submit = readStep(job, 'Submit to App Store for review').text;

  const testflightInput = workflow.match(
    /^      testflight_only:\n((?:        .*\n)+)/m
  )?.[1] ?? '';
  assert.match(testflightInput, /^        required: false$/m);
  assert.match(testflightInput, /^        default: false$/m);
  assert.match(testflightInput, /^        type: boolean$/m);
  assert.doesNotMatch(upload, /inputs\.testflight_only/);
  assert.ok(submit.includes("if: ${{ !cancelled() && steps.fastlane_release.outcome == 'success' && !(github.event_name == 'workflow_dispatch' && inputs.testflight_only) }}"));
});

test('TestFlight-only runs use separate cancellation and job queues', () => {
  const workflow = repository.readFile(IOS_RELEASE);
  const submitWorkflow = repository.readFile('.github/workflows/ios-storefront-submit.yml');
  const testflightRun = "github.event_name == 'workflow_dispatch' && inputs.testflight_only";
  assert.ok(workflow.includes("group: ios-storefront-release-${{ github.ref }}${{ (" + testflightRun + ") && '-testflight' || '' }}"));
  assert.ok(readJob(workflow, 'build-and-submit').includes("group: ${{ (" + testflightRun + ") && 'ios-storefront-testflight-upload' || 'ios-storefront-app-store-submission' }}"));
  assert.match(readJob(submitWorkflow, 'submit'), /group: ios-storefront-app-store-submission/);
});

test('the gate fails when a new PiggyVest mobile file lacks a server-off test', () => {
  const failures = collectGateFailures(withFiles({ [PIN_SHEET]: 'export function WalletPinSheet() {}' }));
  assert.deepEqual(failures, [
    `${PIN_SHEET} is a new or changed PiggyVest storefront file without a server-off test: add ${PIN_SHEET_SERVER_OFF} (see ${GATE_RUNBOOK})`,
  ]);
  const placeholder = withFiles({ [PIN_SHEET]: 'export function WalletPinSheet() {}', [PIN_SHEET_SERVER_OFF]: "test('off', () => {});" });
  assert.deepEqual(collectGateFailures(placeholder), [
    `${PIN_SHEET} is a new or changed PiggyVest storefront file whose server-off test ${PIN_SHEET_SERVER_OFF} does not import it or lacks a live test with an assertion (see ${GATE_RUNBOOK})`,
  ]);
  const covered = withFiles({
    [PIN_SHEET]: 'export function WalletPinSheet() {}',
    [PIN_SHEET_SERVER_OFF]: "import { WalletPinSheet } from './WalletPinSheet';\ntest('off', () => { expect(WalletPinSheet).toBeDefined(); });",
  });
  assert.deepEqual(collectGateFailures(covered), []);
});

test('the gate fails when a storefront release workflow regains its main push trigger', () => {
  const ios = repository.readFile(IOS_RELEASE);
  const pushOnMain = ios.replace('  push:\n    tags:', '  push:\n    branches:\n      - main\n    tags:');
  assert.notEqual(pushOnMain, ios, 'fixture must change the iOS trigger');
  assert.deepEqual(collectGateFailures(withFiles({ [IOS_RELEASE]: pushOnMain })), [
    `${IOS_RELEASE} push trigger must list only tags (found: branches, tags)`,
  ]);
});

test('the gate fails when another workflow ships or dispatches the storefront', () => {
  const easUpdate = 'on:\n  push:\n    branches: [main]\njobs:\n  ota:\n    steps:\n      - working-directory: apps/mobile-storefront\n        run: npx eas update\n';
  const dispatcher = 'on:\n  push:\n    branches: [main]\njobs:\n  a:\n    steps:\n      - run: gh workflow run ios-storefront-release.yml\n';
  assert.deepEqual(
    collectGateFailures(
      withFiles({ '.github/workflows/eas-update.yml': easUpdate, '.github/workflows/nightly.yml': dispatcher })
    ),
    [
      '.github/workflows/eas-update.yml builds or ships the storefront app but is not covered by the storefront release gate',
      '.github/workflows/nightly.yml dispatches the gated .github/workflows/ios-storefront-release.yml',
    ]
  );
  const byName = 'on:\n  push:\n    branches: [main]\njobs:\n  a:\n    steps:\n      - run: gh workflow run "iOS Storefront Production Release" --ref main\n';
  const shippingAction = 'runs:\n  using: composite\n  steps:\n    - working-directory: apps/mobile-storefront\n      run: bundle exec fastlane ios release\n      shell: bash\n';
  const failures = collectGateFailures(
    withFiles({ '.github/workflows/train.yml': byName, '.github/actions/ship-storefront/action.yml': shippingAction })
  );
  assert.equal(failures.length, 2);
  assert.equal(failures[0], '.github/actions/ship-storefront/action.yml builds or ships the storefront app but is not covered by the storefront release gate');
  assert.match(failures[1], /^\.github\/workflows\/train\.yml starts a workflow the storefront release gate cannot identify/);
});

test('the gate fails closed without its marker, runbook or a reachable baseline', () => {
  assert.deepEqual(collectGateFailures(withFiles({ [GATE_MARKER]: null })), [
    `${GATE_MARKER} is missing: the storefront release gate needs its marker (see ${GATE_RUNBOOK})`,
  ]);
  assert.deepEqual(collectGateFailures(withFiles({ [GATE_RUNBOOK]: null })), [`${GATE_RUNBOOK} is missing`]);
  const marker = JSON.parse(repository.readFile(GATE_MARKER));
  const unknownBaseline = JSON.stringify({ ...marker, baseline_commit: 'f'.repeat(40) });
  assert.deepEqual(collectGateFailures(withFiles({ [GATE_MARKER]: unknownBaseline })), [
    `${GATE_MARKER} baseline_commit ${'f'.repeat(40)} must be a commit on main (refs/remotes/origin/main) that HEAD contains; the gate needs full git history`,
  ]);
});

test('the marker has exactly its documented fields', () => {
  const valid = { baseline_commit: 'a'.repeat(40), purpose: 'Hold storefront releases.', runbook: GATE_RUNBOOK };
  assert.deepEqual(parseGateMarker(JSON.stringify(valid)), { marker: valid });
  const invalid = {
    'not JSON': '{',
    'extra field': JSON.stringify({ ...valid, exempt: [] }),
    'short commit': JSON.stringify({ ...valid, baseline_commit: 'abc123' }),
    'empty purpose': JSON.stringify({ ...valid, purpose: ' ' }),
    'other runbook': JSON.stringify({ ...valid, runbook: 'docs/other.md' }),
    'array': '[]',
  };
  for (const [label, text] of Object.entries(invalid)) {
    assert.ok(parseGateMarker(text).error, label);
  }
});

test('the OTA guard must stay in place and run before the source is selected', () => {
  const ota = repository.readFile(OTA_WORKFLOW);
  const misplaced = `${OTA_WORKFLOW} must run the "${OTA_GUARD_STEP}" step right after its checkout and before "Validate and select reviewed source" in its export job`;
  const withoutGuard = ota.replace(`- name: ${OTA_GUARD_STEP}`, '- name: Renamed step');
  assert.deepEqual(collectGateFailures(withFiles({ [OTA_WORKFLOW]: withoutGuard })), [misplaced]);
  const guard = readStep(readJob(ota, 'export'), OTA_GUARD_STEP).text;
  const ownJob = ota
    .replace(`${guard}\n`, '')
    .replace('  export:\n', `  gate:\n    runs-on: ubuntu-24.04\n    steps:\n${guard}\n  export:\n`);
  assert.notEqual(ownJob, ota, 'fixture must move the guard');
  assert.deepEqual(collectGateFailures(withFiles({ [OTA_WORKFLOW]: ownJob })), [
    `${OTA_WORKFLOW} must keep a single job (found: gate, export): the gate guards cover one job`,
    misplaced,
  ]);
  const loosened = guard.replaceAll(GATE_MARKER, '.github/other.json').replace('${{ inputs.source_sha }}', "${{ github.sha }}");
  assert.deepEqual(collectGateFailures(withFiles({ [OTA_WORKFLOW]: ota.replace(guard, loosened) })), [
    `${OTA_WORKFLOW} "${OTA_GUARD_STEP}" must refuse sources that carry ${GATE_MARKER}`,
    `${OTA_WORKFLOW} "${OTA_GUARD_STEP}" must check SOURCE_SHA from inputs.source_sha`,
  ]);
  // Keeping the marker path in a comment or echo while dropping the refusal must not pass.
  const refusalFailure = `${OTA_WORKFLOW} "${OTA_GUARD_STEP}" must refuse sources that carry ${GATE_MARKER}`;
  for (const [from, to] of [
    ['          held="$(git ls-tree --full-tree --name-only "$SOURCE_SHA" -- .github/storefront-release-gate.json)"', '          held=""  # .github/storefront-release-gate.json'],
    ['          if [[ -n "$held" ]]; then', '          if false; then'],
    ['          if ! [[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]; then', '          if false; then'],
    ['          if ! git cat-file -e "${SOURCE_SHA}^{commit}" 2>/dev/null; then', '          if false; then'],
    ['          set -euo pipefail\n          if ! [[', '          set -uo pipefail\n          if ! [['],
    ['          held="$(git', '          held="$(git ls-tree --full-tree --name-only "$SOURCE_SHA" -- x || true)"\n          held="$(git'],
    // The exit moved out of the held-source block, leaving a dead `if false; then exit 1; fi` to supply the count.
    ["gate.md.' >&2\n            exit 1\n          fi", "gate.md.' >&2\n          fi\n          if false; then\n            exit 1\n          fi"],
  ]) {
    const mutated = guard.replace(from, to);
    assert.notEqual(mutated, guard, `fixture must change: ${from}`);
    assert.deepEqual(collectGateFailures(withFiles({ [OTA_WORKFLOW]: ota.replace(guard, mutated) })), [refusalFailure], from);
  }
  const skippable = guard.replace('        env:', '        continue-on-error: true\n        env:');
  assert.deepEqual(collectGateFailures(withFiles({ [OTA_WORKFLOW]: ota.replace(guard, skippable) })), [
    `${OTA_WORKFLOW} "${OTA_GUARD_STEP}" must run unconditionally and fail the export`,
  ]);
});

test('each store release must refuse commits that are not on main before doing anything else', () => {
  const ios = repository.readFile(IOS_RELEASE);
  const guard = readStep(readJob(ios, 'build-and-submit'), RELEASE_GUARD_STEP).text;
  const misplaced = `${IOS_RELEASE} must run "${RELEASE_GUARD_STEP}" right after "Checkout" in its build-and-submit job`;
  assert.deepEqual(collectGateFailures(withFiles({ [IOS_RELEASE]: ios.replace(`${guard}\n`, '') })), [misplaced]);
  const later = ios.replace(`${guard}\n`, '').replace('      - name: Setup pnpm\n', `${guard}\n      - name: Setup pnpm\n`);
  assert.deepEqual(collectGateFailures(withFiles({ [IOS_RELEASE]: later })), [misplaced]);
  const loosened = guard.replace('refs/remotes/origin/main', 'HEAD').replace('${{ github.sha }}', '${{ inputs.build_number }}');
  assert.deepEqual(collectGateFailures(withFiles({ [IOS_RELEASE]: ios.replace(guard, loosened) })), [
    `${IOS_RELEASE} "${RELEASE_GUARD_STEP}" must refuse a RELEASE_SHA from github.sha that is not on refs/remotes/origin/main`,
  ]);
  const skippable = guard.replace('        env:', "        if: github.event_name == 'push'\n        env:");
  assert.deepEqual(collectGateFailures(withFiles({ [IOS_RELEASE]: ios.replace(guard, skippable) })), [
    `${IOS_RELEASE} "${RELEASE_GUARD_STEP}" must run unconditionally and fail the release`,
  ]);
  const android = repository.readFile(ANDROID_RELEASE);
  const shallow = android.replace(/(      - name: Checkout\n(?:        .*\n)*?)          fetch-depth: 0\n/, '$1');
  assert.notEqual(shallow, android, 'fixture must drop the full-history checkout');
  assert.deepEqual(collectGateFailures(withFiles({ [ANDROID_RELEASE]: shallow })), [
    `${ANDROID_RELEASE} "Checkout" in its build-and-deploy job must fetch full history (fetch-depth: 0) so the guard can see main`,
  ]);
});

test('CI must run every gate test, unconditionally, in its changes job', () => {
  const ci = repository.readFile(CI);
  const step = readStep(readJob(ci, 'changes'), 'Test storefront release gate').text;
  const softened = step.replace('        run:', '        continue-on-error: true\n        run:');
  assert.deepEqual(collectGateFailures(withFiles({ [CI]: ci.replace(step, softened) })), [
    `${CI} "Test storefront release gate" must run unconditionally in its changes job`,
  ]);
  const skipped = step.replace('        run:', "        if: github.event_name == 'push'\n        run:");
  assert.deepEqual(collectGateFailures(withFiles({ [CI]: ci.replace(step, skipped) })), [
    `${CI} "Test storefront release gate" must run unconditionally in its changes job`,
  ]);
  const narrowed = step.replace(' .github/scripts/storefront-release-gate-git.test.mjs', '');
  assert.notEqual(narrowed, step, 'fixture must drop a gate test');
  assert.deepEqual(collectGateFailures(withFiles({ [CI]: ci.replace(step, narrowed) })), [
    `${CI} "Test storefront release gate" must run node --test with .github/scripts/storefront-release-gate-git.test.mjs`,
  ]);
  assert.deepEqual(collectGateFailures(withFiles({ [CI]: ci.replace(`${step}\n`, '') })), [
    `${CI} must run the "Test storefront release gate" step in its changes job`,
  ]);
  const jobSkipped = ci.replace('  changes:\n', "  changes:\n    if: github.event_name == 'push'\n");
  assert.notEqual(jobSkipped, ci, 'fixture must add a job condition');
  assert.deepEqual(collectGateFailures(withFiles({ [CI]: jobSkipped })), [`${CI} changes job must run unconditionally`]);
});

test('shipping split across a caller workflow and a local composite action still fails the gate', () => {
  const caller = [
    'name: Nightly',
    'on:',
    '  workflow_dispatch:',
    'jobs:',
    '  ship:',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    '      - uses: ./.github/actions/zz-ship',
    '        with:',
    '          dir: apps/mobile-storefront',
    '',
  ].join('\n');
  const action = "runs:\n  using: composite\n  steps:\n    - shell: bash\n      run: bundle exec fastlane ios release\n";
  const failures = collectGateFailures(
    withFiles({ '.github/workflows/zz-nightly.yml': caller, '.github/actions/zz-ship/action.yml': action })
  );
  assert.ok(
    failures.includes('.github/workflows/zz-nightly.yml builds or ships the storefront app but is not covered by the storefront release gate'),
    failures.join('\n')
  );
});

test('a workflow that pushes a release tag fails the gate', () => {
  const tagger = 'name: Tagger\non:\n  workflow_dispatch:\njobs:\n  tag:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: git push origin v999-storefront\n';
  const failures = collectGateFailures(withFiles({ '.github/workflows/zz-tagger.yml': tagger }));
  assert.equal(failures.filter((failure) => failure.startsWith('.github/workflows/zz-tagger.yml creates a release tag')).length, 1);
});

const SUBMIT = '.github/workflows/ios-storefront-submit.yml';

test('the manual App Store submit must refuse commits that are not on main', () => {
  const submit = repository.readFile(SUBMIT);
  const guard = readStep(readJob(submit, 'submit'), RELEASE_GUARD_STEP).text;
  const misplaced = `${SUBMIT} must run "${RELEASE_GUARD_STEP}" right after "Checkout" in its submit job`;
  assert.deepEqual(collectGateFailures(withFiles({ [SUBMIT]: submit.replace(`${guard}\n`, '') })), [misplaced]);
  const shallow = submit.replace('          fetch-depth: 0\n', '');
  assert.deepEqual(collectGateFailures(withFiles({ [SUBMIT]: shallow })), [
    `${SUBMIT} "Checkout" in its submit job must fetch full history (fetch-depth: 0) so the guard can see main`,
  ]);
});


test('the OTA export may not run anything before its checkout and guard', () => {
  const ota = repository.readFile(OTA_WORKFLOW);
  const first = ota.replace(/uses: actions\/checkout@\S+/, 'run: echo work before the guard');
  assert.notEqual(first, ota, 'fixture must replace the checkout');
  const failures = collectGateFailures(withFiles({ [OTA_WORKFLOW]: first }));
  assert.deepEqual(failures, [`${OTA_WORKFLOW} must start its export job with an actions/checkout step: nothing may run before the guard`]);
});

test('the gate fails when a workflow ships the storefront through a package script that never names the app', () => {
  const withScripts = (file, scripts) => {
    const manifest = JSON.parse(repository.readFile(file));
    return JSON.stringify({ ...manifest, scripts: { ...manifest.scripts, ...scripts } });
  };
  const root = withScripts('package.json', { 'zz:ship': 'turbo run zz:upload' });
  const storefront = withScripts('apps/mobile-storefront/package.json', { 'zz:upload': 'eas submit --platform ios' });
  const workflow = 'on:\n  push:\n    branches: [main]\njobs:\n  a:\n    steps:\n      - run: pnpm run zz:ship\n';
  const failures = collectGateFailures(
    withFiles({ '.github/workflows/nightly-ship.yml': workflow, 'package.json': root, 'apps/mobile-storefront/package.json': storefront })
  );
  assert.ok(
    failures.includes('.github/workflows/nightly-ship.yml builds or ships the storefront app but is not covered by the storefront release gate'),
    failures.join('\n')
  );
});
