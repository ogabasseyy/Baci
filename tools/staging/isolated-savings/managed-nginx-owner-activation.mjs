import { pathToFileURL } from 'node:url';
import { runManagedNginxActivation } from './install-managed-nginx-activation.mjs';
import {
  createManagedNginxOwnerActions,
  readManagedNginxSource,
} from './managed-nginx-owner-actions.mjs';
import { verifySmokeInputs } from './managed-private-smoke.mjs';
import { runPrivateSmoke } from './managed-private-smoke-runner.mjs';

const requireValue = (value) => {
  if (!value) throw new Error('Rejected');
};

export async function runManagedNginxOwnerActivation(options) {
  const input = await verifySmokeInputs(options);
  const source = await readManagedNginxSource();
  await runPrivateSmoke(input, undefined, async ({ binding, evidence }) => {
    await runManagedNginxActivation(
      {
        binding,
        input: { ...evidence, now: Date.now() },
        config: source.content,
      },
      createManagedNginxOwnerActions({ ...input, source })
    );
  });
}

async function main() {
  let stage = 'bootstrap';
  try {
    requireValue(
      process.platform === 'linux' &&
        process.geteuid() === 0 &&
        process.argv.length === 8
    );
    requireValue(
      !['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH'].some(
        (key) => process.env[key]
      )
    );
    const [
      smokeHash,
      runnerHash,
      identityPath,
      identityHash,
      manifestPath,
      manifestHash,
    ] = process.argv.slice(2);
    stage = 'verify-installed';
    await runManagedNginxOwnerActivation({
      self: new URL('./managed-private-smoke.mjs', import.meta.url).pathname,
      runner: new URL('./managed-private-smoke-runner.mjs', import.meta.url)
        .pathname,
      selfHash: smokeHash,
      runnerHash,
      identityPath,
      identityHash,
      manifestPath,
      manifestHash,
    });
  } catch {
    process.stderr.write(
      `Managed Nginx activation refused at ${stage}; no raw error output.\n`
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
