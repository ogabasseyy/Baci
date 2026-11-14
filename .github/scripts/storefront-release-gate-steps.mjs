// Step-level rules of the storefront release gate. Each one reads a single job
// block, so a guard moved into another job (which would no longer hold back
// the job that ships) fails the gate.
import { readJob, readJobIds, readStep, readStepNames } from './storefront-release-gate-workflows.mjs';

export const OTA_GUARD_STEP = 'Refuse sources held by the storefront release gate';
const OTA_SELECTION_STEP = 'Validate and select reviewed source';
export const RELEASE_GUARD_STEP = 'Refuse release sources that are not on main';
const CHECKOUT_STEP = 'Checkout';
export const CI_GATE_STEP = 'Test storefront release gate';
const CONDITION = /^\s*["']?(?:if|continue-on-error)["']?\s*:/m;

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

/** The script's lines without blanks and comments. */
function codeLines(run) {
  return (run ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/**
 * True when the `if` at `at` is a refusal: only echo lines, then `exit 1`, then
 * its own `fi`, so the exit sits inside the block and nothing else can run there.
 */
function refusesInBlock(lines, at) {
  let index = at + 1;
  while (lines[index]?.startsWith('echo ')) index += 1;
  return lines[index] === 'exit 1' && lines[index + 1] === 'fi';
}

/** True when the guard script keeps its refusal constructs in order, outside comments, and cannot swallow a failure. */
function keepsOtaRefusal(run, marker) {
  const lines = codeLines(run);
  let from = 0;
  for (const required of otaRefusalLines(marker)) {
    const at = lines.indexOf(required, from);
    if (at === -1) return false;
    // Each `if` is a refusal block that exits inside itself (the first line is `set`, the lookup an assignment).
    if (required.startsWith('if ') && !refusesInBlock(lines, at)) return false;
    from = at + 1;
  }
  const reassigned = lines.filter((line) => /^held=/.test(line)).length;
  return reassigned === 1 && !lines.some((line) => /\bset\s+\+e\b|\|\|\s*true\b/.test(line));
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
  // Step zero must be the checkout itself, or work could run before the guard and not be undone by it.
  const first = job.split(/^ {6}- /m)[1] ?? '';
  if (!/^\s*uses:\s*actions\/checkout@/m.test(first)) {
    return [`${workflow} must start its export job with an actions/checkout step: nothing may run before the guard`];
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

const RELEASE_REFUSAL_IF = 'if ! git merge-base --is-ancestor "$RELEASE_SHA" refs/remotes/origin/main; then';

/**
 * True when the guard script is exactly `set -euo pipefail`, the ancestry test
 * as an `if !` that echoes and exits 1 inside its own block, and nothing else:
 * no earlier command can rewrite main, and no later one can undo the refusal.
 */
function keepsReleaseRefusal(run) {
  const lines = codeLines(run);
  return lines[0] === 'set -euo pipefail' && lines[1] === RELEASE_REFUSAL_IF && refusesInBlock(lines, 1) && lines.length === lines.indexOf('fi') + 1;
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
  if (!fromGithubSha || !keepsReleaseRefusal(guard.run)) {
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
  if (/\|\||[;&|]|\bset\s+\+e\b/.test(command.slice('node --test '.length))) {
    return [`${workflow} "${CI_GATE_STEP}" must run node --test alone so a failing test fails the step`];
  }
  const listed = new Set(command.split(/\s+/));
  return gateTests
    .filter((file) => !listed.has(file))
    .map((file) => `${workflow} "${CI_GATE_STEP}" must run node --test with ${file}`);
}

// Secrets that are not store credentials: the token every job has and the
// public client configuration the OTA export bundles into the app.
const NON_STORE_SECRET = /^(?:GITHUB_TOKEN|(?:EXPO|NEXT)_PUBLIC_\w+)$/;

/** The store-credential secrets (anything beyond the public client config) a workflow reads. */
export function storeSecretsUsed(text) {
  const names = [...text.matchAll(/\bsecrets(?:\.(\w+)|\[\s*['"](\w+)['"]\s*\])/g)].map((match) => match[1] ?? match[2]);
  return [...new Set(names)].filter((name) => !NON_STORE_SECRET.test(name));
}
