import { pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import { runRemediationJobWithGlobalLock } from '../lib/remediation-global-lock.mjs';
import { runRemediationWorker } from '../lib/remediation-worker.mjs';
import {
  enrichSentryRemediationCandidate,
  fetchSentryRemediationCandidates,
} from '../lib/sentry-error-events.mjs';

export function runSentryMobileErrorRemediator({
  autofixRunner,
  env = process.env,
  fetchFn = fetch,
  logger = console,
  remediationLock,
} = {}) {
  const outputDir =
    env.BACI_SENTRY_REMEDIATION_OUTPUT_DIR ||
    'logs/sentry-mobile-error-remediator';
  const remediatorEnvironment = {
    ...env,
    BACI_REMEDIATION_OUTPUT_DIR: outputDir,
    BACI_REMEDIATION_STATE_PATH:
      env.BACI_SENTRY_REMEDIATION_STATE_PATH ||
      `${outputDir}/handled-state.json`,
  };

  return runRemediationWorker({
    autofixRunner,
    candidateEnricher: enrichSentryRemediationCandidate,
    candidateLoader: fetchSentryRemediationCandidates,
    env: remediatorEnvironment,
    fetchFn,
    logger,
    remediationLock,
    workerName: 'sentry-mobile-error-remediator',
  });
}

async function main(remediationLock) {
  try {
    const result = await runSentryMobileErrorRemediator({ remediationLock });
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
    console.error('[sentry-mobile-error-remediator] Worker failed:', error);
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  config({ path: new URL('../.env', import.meta.url) });
  const exitCode = await runRemediationJobWithGlobalLock({
    main,
    scriptPath: process.argv[1],
  });
  if (exitCode !== null) process.exitCode = exitCode;
}
