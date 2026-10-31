// Storefront release gate. While .github/storefront-release-gate.json exists,
// the storefront apps reach devices only through a deliberate owner action:
// the store release workflows start from an owner tag or a manual dispatch
// (never a push to main), the iOS OTA export refuses sources that carry the
// marker, and every new PiggyVest storefront file needs a server-off test.
// See docs/runbooks/storefront-release-gate.md.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMissingServerOffTests, STOREFRONT_ROOT } from './storefront-release-gate-server-off.mjs';
import {
  dispatchesWorkflow,
  dispatchOnlyFailures,
  readStep,
  readStepNames,
  releaseTriggerFailures,
  shipsStorefront,
} from './storefront-release-gate-workflows.mjs';

export const GATE_MARKER = '.github/storefront-release-gate.json';
export const GATE_RUNBOOK = 'docs/runbooks/storefront-release-gate.md';
export const OTA_WORKFLOW = '.github/workflows/storefront-ota-export.yml';
export const OTA_GUARD_STEP = 'Refuse sources held by the storefront release gate';
const OTA_SELECTION_STEP = 'Validate and select reviewed source';
const RELEASE_WORKFLOWS = new Map([
  ['.github/workflows/ios-storefront-release.yml', ['v*-storefront-ios']],
  ['.github/workflows/android-storefront-release.yml', ['v*-storefront']],
]);
const DISPATCH_ONLY_WORKFLOWS = ['.github/workflows/ios-storefront-submit.yml', OTA_WORKFLOW];
const GATED_WORKFLOWS = [...RELEASE_WORKFLOWS.keys(), ...DISPATCH_ONLY_WORKFLOWS];
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
  for (const [workflow, tags] of RELEASE_WORKFLOWS) {
    const text = repository.readFile(workflow);
    failures.push(...(text === undefined ? [`${workflow} is missing`] : releaseTriggerFailures(workflow, text, tags)));
  }
  for (const workflow of DISPATCH_ONLY_WORKFLOWS) {
    const text = repository.readFile(workflow);
    failures.push(...(text === undefined ? [`${workflow} is missing`] : dispatchOnlyFailures(workflow, text)));
  }
  for (const workflow of [...repository.listWorkflows()].sort()) {
    const text = repository.readFile(workflow) ?? '';
    if (!GATED_WORKFLOWS.includes(workflow) && shipsStorefront(text)) {
      failures.push(`${workflow} builds or ships the storefront app but is not covered by the storefront release gate`);
    }
    for (const gated of GATED_WORKFLOWS) {
      if (dispatchesWorkflow(text, path.basename(gated))) failures.push(`${workflow} dispatches the gated ${gated}`);
    }
  }
  return failures;
}

function otaGuardFailures(repository) {
  const text = repository.readFile(OTA_WORKFLOW);
  if (text === undefined) return [];
  const names = readStepNames(text);
  const guardAt = names.indexOf(OTA_GUARD_STEP);
  const selectionAt = names.indexOf(OTA_SELECTION_STEP);
  if (guardAt === -1 || selectionAt === -1 || guardAt > selectionAt) {
    return [`${OTA_WORKFLOW} must run the "${OTA_GUARD_STEP}" step before "${OTA_SELECTION_STEP}"`];
  }
  const guard = readStep(text, OTA_GUARD_STEP);
  const failures = [];
  if (!guard.run?.includes(GATE_MARKER)) {
    failures.push(`${OTA_WORKFLOW} "${OTA_GUARD_STEP}" must refuse sources that carry ${GATE_MARKER}`);
  }
  if (!/^\s*SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}\s*$/m.test(guard.text)) {
    failures.push(`${OTA_WORKFLOW} "${OTA_GUARD_STEP}" must check SOURCE_SHA from inputs.source_sha`);
  }
  if (/^\s*(?:if|continue-on-error)\s*:/m.test(guard.text)) {
    failures.push(`${OTA_WORKFLOW} "${OTA_GUARD_STEP}" must run unconditionally and fail the export`);
  }
  return failures;
}

function serverOffFailures(repository, baselineCommit) {
  const baseline = repository.listBaseline(baselineCommit, STOREFRONT_ROOT);
  if (baseline === undefined) {
    return [`${GATE_MARKER} baseline_commit ${baselineCommit} is not an ancestor of HEAD (the gate needs full git history)`];
  }
  const existing = new Set(baseline);
  const tracked = repository.listTracked(STOREFRONT_ROOT);
  const newFiles = tracked.filter((file) => !existing.has(file));
  return findMissingServerOffTests({
    newFiles,
    tracked,
    readContent: (file) => repository.readFile(file) ?? '',
  }).map(
    ({ file, expected }) =>
      `${file} is a new PiggyVest storefront file without a server-off test: add ${expected} (see ${GATE_RUNBOOK})`
  );
}

/**
 * Every way the repository currently breaks the gate (empty when it holds).
 * `repository` supplies readFile(path) -> string | undefined, listWorkflows(),
 * listTracked(directory) and listBaseline(commit, directory) -> paths, or
 * undefined when the commit is not an ancestor of HEAD.
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
    ...otaGuardFailures(repository),
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
        if (error.code === 'ENOENT') return undefined;
        throw error;
      }
    },
    listWorkflows: () => listFiles('.github/workflows').filter((file) => /\.ya?ml$/.test(file)),
    listTracked: listFiles,
    listBaseline(commit, directory) {
      try {
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
