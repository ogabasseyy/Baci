import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { operateWorkerRelease } from '../../vps-workers/lib/worker-release-broker-client.mjs';

export async function checkWorkerReleaseReadiness({ env = process.env, broker = operateWorkerRelease, write = appendFileSync } = {}) {
  const sha = env.BACI_EXPECTED_APP_SHA ?? env.GITHUB_SHA;
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('worker readiness expected SHA is invalid');

  const receipt = await broker({ operation: 'readiness', sha });
  if (receipt.ready !== true || receipt.sourceSha !== sha || receipt.installedSha !== sha) {
    throw new Error('broker worker readiness receipt does not match the exact release SHA');
  }

  const outputs = [
    'worker_units_ready=true',
    `installed_sha=${receipt.installedSha}`,
  ].join('\n') + '\n';

  if (env.GITHUB_OUTPUT) write(env.GITHUB_OUTPUT, outputs, { mode: 0o600 });
  else process.stdout.write(outputs);
  return outputs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkWorkerReleaseReadiness().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
