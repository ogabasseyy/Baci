// Storefront release gate. While .github/storefront-release-gate.json exists,
// the storefront apps reach devices only through a deliberate owner action:
// the store release workflows start from an owner tag or a manual dispatch
// (never a push to main) and ship only commits on main, the iOS OTA export
// refuses sources that carry the marker, and every new PiggyVest storefront
// file needs a server-off test. See docs/runbooks/storefront-release-gate.md.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandReferences } from './storefront-release-gate-references.mjs';
import { dispatchFailures } from './storefront-release-gate-dispatch.mjs';
import { findMissingServerOffTests, STOREFRONT_ROOT } from './storefront-release-gate-server-off.mjs';
import { ciGateFailures, otaGuardFailures, releaseGuardFailures, storeSecretsUsed } from './storefront-release-gate-steps.mjs';
import { dispatchOnlyFailures, readJobIds, releaseTriggerFailures, shipsStorefront } from './storefront-release-gate-workflows.mjs';

export { OTA_GUARD_STEP, RELEASE_GUARD_STEP } from './storefront-release-gate-steps.mjs';

export const GATE_MARKER = '.github/storefront-release-gate.json';
export const GATE_RUNBOOK = 'docs/runbooks/storefront-release-gate.md';
export const OTA_WORKFLOW = '.github/workflows/storefront-ota-export.yml';
export const RELEASE_WORKFLOWS = new Map([
  ['.github/workflows/ios-storefront-release.yml', { tags: ['v*-storefront-ios'], job: 'build-and-submit' }],
  ['.github/workflows/android-storefront-release.yml', { tags: ['v*-storefront'], job: 'build-and-deploy' }],
]);
// Dispatch-only workflows that hold store credentials run the same on-main guard.
const GUARDED_DISPATCH_WORKFLOWS = new Map([['.github/workflows/ios-storefront-submit.yml', { job: 'submit' }]]);
const DISPATCH_ONLY_WORKFLOWS = ['.github/workflows/ios-storefront-submit.yml', OTA_WORKFLOW];
const GATED_WORKFLOWS = [...RELEASE_WORKFLOWS.keys(), ...DISPATCH_ONLY_WORKFLOWS];
const CI_WORKFLOW = '.github/workflows/ci.yml';
const GATE_TEST = /^\.github\/scripts\/storefront-release-gate(?:-[\w-]+)?\.test\.mjs$/;
// Releases must come from main; the gate baseline must be a main commit.
export const MAIN_REF = 'refs/remotes/origin/main';
const MARKER_FIELDS = ['baseline_commit', 'purpose', 'runbook'];

/** Validates the marker: exactly its documented fields, a full baseline SHA and this runbook. */
export function parseGateMarker(text) {
  let marker;
  try {
    marker = JSON.parse(text);
  } catch {
    return { error: 'is not valid JSON' };
  }
  if (marker === null || typeof marker !== 'object' || Array.isArray(marker)) return { error: 'must be a JSON object' };
  if (Object.keys(marker).sort().join(',') !== MARKER_FIELDS.join(',')) {
    return { error: `must have exactly the fields ${MARKER_FIELDS.join(', ')}` };
  }
  if (typeof marker.baseline_commit !== 'string' || !/^[0-9a-f]{40}$/.test(marker.baseline_commit)) {
    return { error: 'baseline_commit must be a full 40-character commit SHA' };
  }
  if (typeof marker.purpose !== 'string' || marker.purpose.trim() === '') return { error: 'purpose must be a sentence' };
  if (marker.runbook !== GATE_RUNBOOK) return { error: `runbook must be ${GATE_RUNBOOK}` };
  return { marker };
}

function workflowFailures(repository) {
  const failures = [];
  for (const [workflow, { tags, job }] of RELEASE_WORKFLOWS) {
    const text = repository.readFile(workflow);
    if (text === undefined) failures.push(`${workflow} is missing`);
    else failures.push(...releaseTriggerFailures(workflow, text, tags), ...releaseGuardFailures(workflow, text, job));
  }
  for (const workflow of DISPATCH_ONLY_WORKFLOWS) {
    const text = repository.readFile(workflow);
    if (text === undefined) {
      failures.push(`${workflow} is missing`);
      continue;
    }
    failures.push(...dispatchOnlyFailures(workflow, text));
    const guarded = GUARDED_DISPATCH_WORKFLOWS.get(workflow);
    if (guarded) failures.push(...releaseGuardFailures(workflow, text, guarded.job));
    // The OTA export is held by its own marker guard (otaGuardFailures).
    else if (workflow !== OTA_WORKFLOW && storeSecretsUsed(text).length > 0) {
      failures.push(`${workflow} uses store secrets (${storeSecretsUsed(text).join(', ')}) but has no on-main release guard`);
    }
  }
  // The guards cover one job each, so a gated workflow may hold no other job.
  for (const workflow of GATED_WORKFLOWS) {
    const jobs = readJobIds(repository.readFile(workflow) ?? '');
    if (jobs.length > 1) failures.push(`${workflow} must keep a single job (found: ${jobs.join(', ')}): the gate guards cover one job`);
  }
  // Composite actions run inside the workflow that uses them, so they follow
  // the same rules as workflows that are not gated.
  for (const file of [...repository.listWorkflows(), ...repository.listActions()].sort()) {
    // The scripts a file runs count as part of it: delegating the build,
    // upload or dispatch to a script must not hide it from the gate.
    const { text, scopedText, missing } = expandReferences(repository.readFile(file) ?? '', repository.readFile);
    for (const script of missing) {
      failures.push(`${file} runs ${script}, which is missing: the storefront release gate cannot read what it does`);
    }
    if (!GATED_WORKFLOWS.includes(file) && shipsStorefront(text, scopedText)) {
      failures.push(`${file} builds or ships the storefront app but is not covered by the storefront release gate`);
    }
    failures.push(...dispatchFailures(file, text, GATED_WORKFLOWS));
  }
  return failures;
}

function stepFailures(repository) {
  const ota = repository.readFile(OTA_WORKFLOW);
  const ci = repository.readFile(CI_WORKFLOW);
  const gateTests = repository.listTracked('.github/scripts').filter((file) => GATE_TEST.test(file)).sort();
  return [
    ...(ota === undefined ? [] : otaGuardFailures(OTA_WORKFLOW, ota, GATE_MARKER)),
    ...(ci === undefined ? [`${CI_WORKFLOW} is missing`] : ciGateFailures(CI_WORKFLOW, ci, gateTests)),
  ];
}

function serverOffFailures(repository, baselineCommit) {
  const baseline = repository.listBaseline(baselineCommit, STOREFRONT_ROOT);
  if (baseline === undefined) {
    return [
      `${GATE_MARKER} baseline_commit ${baselineCommit} must be a commit on main (${MAIN_REF}) that HEAD contains; the gate needs full git history`,
    ];
  }
  const existing = new Set(baseline);
  const tracked = repository.listTracked(STOREFRONT_ROOT);
  // New files and files changed since the baseline both need a server-off test:
  // editing an existing wallet or savings file can land half-built UI too.
  const changed = new Set(repository.listChanged(baselineCommit, STOREFRONT_ROOT));
  const newFiles = tracked.filter((file) => !existing.has(file) || changed.has(file));
  return findMissingServerOffTests({
    newFiles,
    tracked,
    readContent: (file) => repository.readFile(file) ?? '',
  }).map(({ file, expected, test }) =>
    test === undefined
      ? `${file} is a new or changed PiggyVest storefront file without a server-off test: add ${expected} (see ${GATE_RUNBOOK})`
      : `${file} is a new or changed PiggyVest storefront file whose server-off test ${test} does not import it or lacks a live test with an assertion (see ${GATE_RUNBOOK})`
  );
}

/**
 * Every way the repository currently breaks the gate (empty when it holds).
 * `repository` supplies readFile(path) -> string | undefined, listWorkflows(),
 * listActions(), listTracked(directory), listChanged(commit, directory) (files
 * differing from that commit) and listBaseline(commit, directory) -> paths, or undefined unless the commit is on main and HEAD contains it.
 */
export function collectGateFailures(repository) {
  const markerText = repository.readFile(GATE_MARKER);
  if (markerText === undefined) {
    return [`${GATE_MARKER} is missing: the storefront release gate needs its marker (see ${GATE_RUNBOOK})`];
  }
  const { marker, error } = parseGateMarker(markerText);
  if (error) return [`${GATE_MARKER} ${error}`];
  return [
    ...(repository.readFile(GATE_RUNBOOK) === undefined ? [`${GATE_RUNBOOK} is missing`] : []),
    ...workflowFailures(repository),
    ...stepFailures(repository),
    ...serverOffFailures(repository, marker.baseline_commit),
  ];
}

/** Repository facts read from a git checkout (tracked plus untracked, unignored files). */
export function gitRepository(root) {
  const git = (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const paths = (output) => output.split('\0').filter(Boolean);
  const listFiles = (directory) => paths(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', directory]));
  return {
    readFile(file) {
      try {
        return readFileSync(path.join(root, file), 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'EISDIR') return undefined;
        throw error;
      }
    },
    listWorkflows: () => listFiles('.github/workflows').filter((file) => /\.ya?ml$/.test(file)),
    listActions: () => listFiles('.github/actions').filter((file) => /(?:^|\/)action\.ya?ml$/.test(file)),
    listTracked: listFiles,
    listChanged: (commit, directory) =>
      paths(git(['diff', '--name-only', '-z', '--diff-filter=AMR', commit, '--', directory])),
    listBaseline(commit, directory) {
      // A pull request's own commit is an ancestor of its CI merge commit but
      // never reaches main, so the baseline must also be on main.
      try {
        git(['merge-base', '--is-ancestor', commit, MAIN_REF]);
        git(['merge-base', '--is-ancestor', commit, 'HEAD']);
      } catch {
        return undefined;
      }
      return paths(git(['ls-tree', '-r', '-z', '--name-only', commit, '--', directory]));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = collectGateFailures(gitRepository(fileURLToPath(new URL('../../', import.meta.url))));
  for (const failure of failures) console.error(`::error::${failure}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}
