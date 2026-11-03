// Step-level rules of the storefront release gate. Each one reads a single job
// block, so a guard moved into another job (which would no longer hold back
// the job that ships) fails the gate.
import { readJob, readJobIds, readStep, readStepNames } from './storefront-release-gate-workflows.mjs';

export const OTA_GUARD_STEP = 'Refuse sources held by the storefront release gate';
const OTA_SELECTION_STEP = 'Validate and select reviewed source';
export const RELEASE_GUARD_STEP = 'Refuse release sources that are not on main';
const CHECKOUT_STEP = 'Checkout';
export const CI_GATE_STEP = 'Test storefront release gate';
const CONDITION = /^\s*(?:if|continue-on-error)\s*:/m;

// The refusal logic the OTA guard must keep, as exact script lines in order:
// the SHA format check, the commit existence check, the marker lookup in the
// source tree and the non-empty exit, each followed by an `exit 1`.
function otaRefusalLines(marker) {
  return [
    'set -euo pipefail',
    'if ! [[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]; then',
    'if ! git cat-file -e "${SOURCE_SHA}^{commit}" 2>/dev/null; then',
    `held="$(git ls-tree --full-tree --name-only "$SOURCE_SHA" -- ${marker})"`,
    'if [[ -n "$held" ]]; then',
  ];
}

/** True when the guard script keeps its refusal constructs in order, outside comments, and cannot swallow a failure. */
function keepsOtaRefusal(run, marker) {
  const lines = (run ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  let from = 0;
  for (const required of otaRefusalLines(marker)) {
    const at = lines.indexOf(required, from);
    if (at === -1) return false;
    from = at + 1;
  }
  const exits = lines.filter((line) => line === 'exit 1').length;
  const reassigned = lines.filter((line) => /^held=/.test(line)).length;
  return exits >= 3 && reassigned === 1 && !lines.some((line) => /\bset\s+\+e\b|\|\|\s*true\b/.test(line));
}

/** The iOS OTA export must refuse sources that carry `marker` before it selects one. */
export function otaGuardFailures(workflow, text, marker) {
  const job = readJob(text, 'export') ?? '';
  const names = readStepNames(job);
  const guardAt = names.indexOf(OTA_GUARD_STEP);
  const selectionAt = names.indexOf(OTA_SELECTION_STEP);
  // Counting unnamed steps too: nothing but the checkout may run before the guard.
  if (guardAt !== 1 || selectionAt === -1 || guardAt > selectionAt) {
    return [`${workflow} must run the "${OTA_GUARD_STEP}" step right after its checkout and before "${OTA_SELECTION_STEP}" in its export job`];
  }
  const guard = readStep(job, OTA_GUARD_STEP);
  const failures = [];
  if (!keepsOtaRefusal(guard.run, marker)) {
    failures.push(`${workflow} "${OTA_GUARD_STEP}" must refuse sources that carry ${marker}`);
  }
  if (!/^\s*SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}\s*$/m.test(guard.text)) {
    failures.push(`${workflow} "${OTA_GUARD_STEP}" must check SOURCE_SHA from inputs.source_sha`);
  }
  if (CONDITION.test(guard.text)) {
    failures.push(`${workflow} "${OTA_GUARD_STEP}" must run unconditionally and fail the export`);
  }
  return failures;
}

/**
 * A store release must refuse a commit that is not on main before it does
 * anything else, so a tag or a manual run can never ship unmerged code.
 */
export function releaseGuardFailures(workflow, text, jobId) {
  const job = readJob(text, jobId);
  if (job === undefined) return [`${workflow} has no ${jobId} job`];
  if (readJobIds(text).length !== 1) {
    return [`${workflow} must keep ${jobId} as its only job: the on-main guard covers a single job`];
  }
  const names = readStepNames(job);
  if (names[0] !== CHECKOUT_STEP || names[1] !== RELEASE_GUARD_STEP) {
    return [`${workflow} must run "${RELEASE_GUARD_STEP}" right after "${CHECKOUT_STEP}" in its ${jobId} job`];
  }
  const failures = [];
  if (!/^\s*fetch-depth:\s*0\s*$/m.test(readStep(job, CHECKOUT_STEP).text)) {
    failures.push(
      `${workflow} "${CHECKOUT_STEP}" in its ${jobId} job must fetch full history (fetch-depth: 0) so the guard can see main`
    );
  }
  const guard = readStep(job, RELEASE_GUARD_STEP);
  const fromGithubSha = /^\s*RELEASE_SHA: \$\{\{ github\.sha \}\}\s*$/m.test(guard.text);
  if (!fromGithubSha || !guard.run?.includes('git merge-base --is-ancestor "$RELEASE_SHA" refs/remotes/origin/main')) {
    failures.push(
      `${workflow} "${RELEASE_GUARD_STEP}" must refuse a RELEASE_SHA from github.sha that is not on refs/remotes/origin/main`
    );
  }
  if (CONDITION.test(guard.text)) {
    failures.push(`${workflow} "${RELEASE_GUARD_STEP}" must run unconditionally and fail the release`);
  }
  return failures;
}

/** CI must run every gate test, unconditionally, in its unfiltered changes job. */
export function ciGateFailures(workflow, text, gateTests) {
  const job = readJob(text, 'changes');
  if (job === undefined) return [`${workflow} has no changes job`];
  if (/^    (?:if|continue-on-error)\s*:/m.test(job)) return [`${workflow} changes job must run unconditionally`];
  const step = readStep(job, CI_GATE_STEP);
  if (step === undefined) return [`${workflow} must run the "${CI_GATE_STEP}" step in its changes job`];
  if (CONDITION.test(step.text)) return [`${workflow} "${CI_GATE_STEP}" must run unconditionally in its changes job`];
  const command = step.text.match(/^\s*run:\s*(node --test .*)$/m)?.[1] ?? '';
  const listed = new Set(command.split(/\s+/));
  return gateTests
    .filter((file) => !listed.has(file))
    .map((file) => `${workflow} "${CI_GATE_STEP}" must run node --test with ${file}`);
}
