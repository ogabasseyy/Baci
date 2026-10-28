import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { operateWorkerRelease } from '../../vps-workers/lib/worker-release-broker-client.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;

export async function runGiglCapabilitySmoke({ env = process.env, broker = operateWorkerRelease } = {}) {
  const sha = env.BACI_EXPECTED_APP_SHA ?? env.GITHUB_SHA;
  if (!SHA_RE.test(sha ?? '')) throw new Error('GIGL capability smoke expected SHA is invalid');
  const receipt = await broker({ operation: 'gigl-capability', sha });
  if (receipt.operation !== 'gigl-capability' || receipt.sourceSha !== sha ||
      receipt.smokePassed !== true || receipt.latched !== true ||
      !['enabled', 'disabled'].includes(receipt.scope) ||
      !SHA_RE.test(receipt.installedSha ?? '') || receipt.installedSha !== sha ||
      receipt.latchedSha !== receipt.installedSha) {
    throw new Error('broker GIGL capability smoke receipt is invalid');
  }
  return `GIGL capability smoke and latch passed for installed worker ${receipt.installedSha} (${receipt.scope}).\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runGiglCapabilitySmoke().then((message) => process.stdout.write(message)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
