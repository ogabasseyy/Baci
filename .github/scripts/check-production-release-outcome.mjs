import { appendFileSync } from 'node:fs';

const jobNames = [
  'changes',
  'vps-drain-readiness',
  'db-migrations',
  'gigl-worker-capability',
  'cwv-runner-contracts',
  'deploy-production',
];
const jobResults = new Set(['success', 'failure', 'cancelled', 'skipped']);

function resultOf(needs, name) {
  const result = needs[name]?.result;
  return jobResults.has(result) ? result : 'unknown';
}

function booleanSignal(value) {
  return value === 'true' || value === 'false' ? value : 'unknown';
}

function report(message, failed, needs = {}) {
  // Only names and enum values defined here enter logs. Never echo raw needs,
  // environment values, parser errors, credential identities, or fingerprints.
  const diagnostics = jobNames.map(
    (name) => `${name}: ${resultOf(needs, name)}`
  );
  for (const name of ['web', 'migrations', 'tracking']) {
    diagnostics.push(
      `${name}: ${booleanSignal(needs.changes?.outputs?.[name])}`
    );
  }
  for (const name of [
    'cutover_latched',
    'tracking_stale',
    'installed_tracking_stale',
    'manifest_drift',
  ]) {
    diagnostics.push(
      `${name}: ${booleanSignal(needs['vps-drain-readiness']?.outputs?.[name])}`
    );
  }
  const details = diagnostics.map((line) => `- ${line}`).join('\n');
  const summary = `## Production release outcome\n\n${message}\n\n${details}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  const stream = failed ? process.stderr : process.stdout;
  stream.write(`${message}\n${details}\n`);
  process.exitCode = failed ? 1 : 0;
}

function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/main') {
    report(
      'Production publication check does not apply to this branch.',
      false
    );
    return;
  }

  let needs;
  try {
    needs = JSON.parse(process.env.RELEASE_NEEDS_JSON ?? '');
    if (!needs || typeof needs !== 'object' || Array.isArray(needs)) {
      throw new Error('Invalid results');
    }
  } catch {
    report(
      'Invalid production release results; cannot confirm publication.',
      true
    );
    return;
  }

  const event = process.env.GITHUB_EVENT_NAME;
  const changesResult = resultOf(needs, 'changes');
  const manual = event === 'workflow_dispatch';
  const validChanges =
    changesResult === 'success' || (manual && changesResult === 'skipped');
  const web = booleanSignal(needs.changes?.outputs?.web);
  const migrations = booleanSignal(needs.changes?.outputs?.migrations);
  if (
    !validChanges ||
    (!manual &&
      (event !== 'push' || web === 'unknown' || migrations === 'unknown'))
  ) {
    report(
      'Cannot determine production release scope; publication is unconfirmed.',
      true,
      needs
    );
    return;
  }

  if (!manual && web === 'false' && migrations === 'false') {
    report(
      'Production publication not required for this change.',
      false,
      needs
    );
    return;
  }

  const deploymentResult = resultOf(needs, 'deploy-production');
  if (deploymentResult !== 'success') {
    report(
      `Production publication required but deploy-production is ${deploymentResult}. Inspect the release gates before retrying; do not bypass worker validation.`,
      true,
      needs
    );
    return;
  }
  report(
    'Production publication completed; deploy-production succeeded.',
    false,
    needs
  );
}

try {
  main();
} catch {
  process.stderr.write(
    'Could not record production release outcome; publication is unconfirmed.\n'
  );
  process.exitCode = 1;
}
