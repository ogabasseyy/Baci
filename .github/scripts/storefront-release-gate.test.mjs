import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
} from './storefront-release-gate.mjs';
import { readStep } from './storefront-release-gate-workflows.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const repository = gitRepository(ROOT);
const IOS_RELEASE = '.github/workflows/ios-storefront-release.yml';
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
    listTracked: (root) => [...new Set([...repository.listTracked(root), ...added.filter((file) => file.startsWith(`${root}/`))])],
  };
}

test('the repository satisfies the storefront release gate', () => {
  assert.deepEqual(collectGateFailures(repository), []);
});

test('the gate fails when a new PiggyVest mobile file lacks a server-off test', () => {
  const failures = collectGateFailures(withFiles({ [PIN_SHEET]: 'export function WalletPinSheet() {}' }));
  assert.deepEqual(failures, [
    `${PIN_SHEET} is a new PiggyVest storefront file without a server-off test: add ${PIN_SHEET_SERVER_OFF} (see ${GATE_RUNBOOK})`,
  ]);
  const covered = withFiles({ [PIN_SHEET]: 'export function WalletPinSheet() {}', [PIN_SHEET_SERVER_OFF]: "test('off', () => {});" });
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
});

test('the gate fails closed without its marker, runbook or a reachable baseline', () => {
  assert.deepEqual(collectGateFailures(withFiles({ [GATE_MARKER]: null })), [
    `${GATE_MARKER} is missing: the storefront release gate needs its marker (see ${GATE_RUNBOOK})`,
  ]);
  assert.deepEqual(collectGateFailures(withFiles({ [GATE_RUNBOOK]: null })), [`${GATE_RUNBOOK} is missing`]);
  const marker = JSON.parse(repository.readFile(GATE_MARKER));
  const unknownBaseline = JSON.stringify({ ...marker, baseline_commit: 'f'.repeat(40) });
  assert.deepEqual(collectGateFailures(withFiles({ [GATE_MARKER]: unknownBaseline })), [
    `${GATE_MARKER} baseline_commit ${'f'.repeat(40)} is not an ancestor of HEAD (the gate needs full git history)`,
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
  const withoutGuard = ota.replace(`- name: ${OTA_GUARD_STEP}`, '- name: Renamed step');
  assert.deepEqual(collectGateFailures(withFiles({ [OTA_WORKFLOW]: withoutGuard })), [
    `${OTA_WORKFLOW} must run the "${OTA_GUARD_STEP}" step before "Validate and select reviewed source"`,
  ]);
  const guard = readStep(ota, OTA_GUARD_STEP).text;
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

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Gate Test',
      GIT_AUTHOR_EMAIL: 'gate@example.test',
      GIT_AUTHOR_DATE: '2026-10-31T00:00:00Z',
      GIT_COMMITTER_NAME: 'Gate Test',
      GIT_COMMITTER_EMAIL: 'gate@example.test',
      GIT_COMMITTER_DATE: '2026-10-31T00:00:00Z',
    },
  }).trim();
}

test('the OTA export refuses a source that carries the gate marker', () => {
  const guard = readStep(repository.readFile(OTA_WORKFLOW), OTA_GUARD_STEP)?.run;
  assert.ok(guard, 'the OTA guard step must have a run script');
  const dir = mkdtempSync(path.join(tmpdir(), 'storefront-release-gate-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(dir, 'README.md'), 'before the gate\n');
    git(dir, 'add', 'README.md');
    git(dir, 'commit', '-q', '-m', 'before the gate');
    const unmarked = git(dir, 'rev-parse', 'HEAD');
    mkdirSync(path.join(dir, '.github'));
    writeFileSync(path.join(dir, GATE_MARKER), '{}\n');
    git(dir, 'add', GATE_MARKER);
    git(dir, 'commit', '-q', '-m', 'gate');
    const marked = git(dir, 'rev-parse', 'HEAD');
    const run = (sourceSha) =>
      spawnSync('bash', ['-c', guard], {
        cwd: dir,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', SOURCE_SHA: sourceSha },
      });
    assert.equal(run(unmarked).status, 0, run(unmarked).stderr);
    const refused = run(marked);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /storefront release gate/);
    assert.match(refused.stderr, /docs\/runbooks\/storefront-release-gate\.md/);
    assert.notEqual(run('e'.repeat(40)).status, 0, 'an unknown commit must fail closed');
    assert.notEqual(run('main').status, 0, 'a branch name is not a reviewed source SHA');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
