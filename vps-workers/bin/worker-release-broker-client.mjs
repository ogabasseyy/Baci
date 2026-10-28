#!/usr/bin/env node
import { stageWorkerReleaseFromEnvironment } from '../lib/worker-release-broker-client.mjs';

try {
  const receipt = await stageWorkerReleaseFromEnvironment();
  process.stdout.write(JSON.stringify({
    operation: receipt.operation,
    sourceSha: receipt.sourceSha,
    entryCount: receipt.entryCount,
  }) + '\n');
} catch (error) {
  // Never print request fields, credentials, OIDC claims, or provider/API bodies.
  if (error?.indeterminateBrokerOutcome === true) {
    process.stderr.write('worker release broker outcome is indeterminate; reconcile stage SHA before retrying\n');
    process.exitCode = 2;
  } else {
    process.stderr.write('worker release broker stage request failed; inspect broker and coordinator diagnostics\n');
    process.exitCode = 1;
  }
}
