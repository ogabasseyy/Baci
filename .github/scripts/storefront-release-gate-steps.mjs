// Step-level rules of the storefront release gate. Each one reads a single job
// block, so a guard moved into another job (which would no longer hold back
// the job that ships) fails the gate.
import { readJob, readStep, readStepNames } from './storefront-release-gate-workflows.mjs';

export const OTA_GUARD_STEP = 'Refuse sources held by the storefront release gate';
const OTA_SELECTION_STEP = 'Validate and select reviewed source';
export const RELEASE_GUARD_STEP = 'Refuse release sources that are not on main';
const CHECKOUT_STEP = 'Checkout';
export const CI_GATE_STEP = 'Test storefront release gate';
const CONDITION = /^\s*(?:if|continue-on-error)\s*:/m;

/** The iOS OTA export must refuse sources that carry `marker` before it selects one. */
export function otaGuardFailures(workflow, text, marker) {
  const job = readJob(text, 'export') ?? '';
  const names = readStepNames(job);
  const guardAt = names.indexOf(OTA_GUARD_STEP);
  const selectionAt = names.indexOf(OTA_SELECTION_STEP);
  if (guardAt === -1 || selectionAt === -1 || guardAt > selectionAt) {
    return [`${workflow} must run the "${OTA_GUARD_STEP}" step before "${OTA_SELECTION_STEP}" in its export job`];
  }
  const guard = readStep(job, OTA_GUARD_STEP);
  const failures = [];
  if (!guard.run?.includes(marker)) {
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
