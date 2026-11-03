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

test('the gate fails when a new PiggyVest mobile file lacks a server-off test', () => {
  const failures = collectGateFailures(withFiles({ [PIN_SHEET]: 'export function WalletPinSheet() {}' }));
  assert.deepEqual(failures, [
    `${PIN_SHEET} is a new or changed PiggyVest storefront file without a server-off test: add ${PIN_SHEET_SERVER_OFF} (see ${GATE_RUNBOOK})`,
  ]);
  const placeholder = withFiles({ [PIN_SHEET]: 'export function WalletPinSheet() {}', [PIN_SHEET_SERVER_OFF]: "test('off', () => {});" });
  assert.deepEqual(collectGateFailures(placeholder), [
    `${PIN_SHEET} is a new or changed PiggyVest storefront file whose server-off test ${PIN_SHEET_SERVER_OFF} does not import it (see ${GATE_RUNBOOK})`,
  ]);
  const covered = withFiles({
    [PIN_SHEET]: 'export function WalletPinSheet() {}',
    [PIN_SHEET_SERVER_OFF]: "import { WalletPinSheet } from './WalletPinSheet';\ntest('off', () => {});",
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
  const jobSkipped = ci.replace('  changes:\n    runs-on: ubuntu-24.04\n', "  changes:\n    if: github.event_name == 'push'\n    runs-on: ubuntu-24.04\n");
  assert.notEqual(jobSkipped, ci, 'fixture must add a job condition');
  assert.deepEqual(collectGateFailures(withFiles({ [CI]: jobSkipped })), [`${CI} changes job must run unconditionally`]);
});
