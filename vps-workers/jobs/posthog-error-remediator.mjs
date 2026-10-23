import { pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import { fetchPostHogRemediationCandidates } from '../lib/posthog-error-events.mjs';
import { enrichPostHogRemediationCandidate } from '../lib/posthog-issue-enrichment.mjs';
import { runRemediationJobWithGlobalLock } from '../lib/remediation-global-lock.mjs';
import { runRemediationWorker } from '../lib/remediation-worker.mjs';

export function runPostHogErrorRemediator({
  autofixRunner,
  env = process.env,
  fetchFn = fetch,
  logger = console,
  remediationLock,
} = {}) {
  if (env.BACI_POSTHOG_REMEDIATION_ENABLED !== '1') {
    return {
      actions: [],
      candidates: [],
      email: null,
      mode: 'disabled',
      skipped: true,
    };
  }
  const outputDir =
    env.BACI_POSTHOG_REMEDIATION_OUTPUT_DIR || 'logs/posthog-error-remediator';
  const remediatorEnvironment = {
    ...env,
    BACI_REMEDIATION_OUTPUT_DIR: outputDir,
    BACI_REMEDIATION_STATE_PATH:
      env.BACI_POSTHOG_REMEDIATION_STATE_PATH ||
      `${outputDir}/handled-state.json`,
  };
  const candidateLoader = fetchPostHogRemediationCandidates;

  return runRemediationWorker({
    autofixRunner,
    candidateEnricher: enrichPostHogRemediationCandidate,
    candidateLoader,
    env: remediatorEnvironment,
    fetchFn,
    logger,
    remediationLock,
    workerName: 'posthog-error-remediator',
  });
}

async function main(remediationLock) {
  try {
    const result = await runPostHogErrorRemediator({ remediationLock });
    console.log(
      JSON.stringify(
        {
          actions: result.actions,
          candidates: result.candidates.length,
          email: result.email,
          mode: result.mode,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error('[posthog-error-remediator] Worker failed:', error);
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  config({ path: new URL('../.env', import.meta.url), quiet: true });
  if (process.env.BACI_POSTHOG_REMEDIATION_ENABLED !== '1') {
    // Disabled by default: exit before the global lock so a dormant tick
    // neither contends with sibling remediators nor logs busy failures.
    // The in-function guard below stays for library callers.
    process.exit(0);
  }
  const exitCode = await runRemediationJobWithGlobalLock({
    main,
    scriptPath: process.argv[1],
  });
  if (exitCode !== null) process.exitCode = exitCode;
}
