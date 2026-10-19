import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runManagedNginxActivation } from './install-managed-nginx-activation.mjs';
import { runHostedDraftActivation } from './managed-hosted-draft-activation-runner.mjs';
import {
  createManagedNginxOwnerActions,
  readManagedNginxSource,
} from './managed-nginx-owner-actions.mjs';
import { verifySmokeInputs } from './managed-private-smoke.mjs';

export const hostedDraftActivationFailureSteps = Object.freeze({
  bootstrap: 'bootstrap',
  verifyInstalled: 'verify-installed',
  readNginxSource: 'read-nginx-source',
  activate: 'activate',
});

export function hostedDraftActivationFailureMessage(step) {
  const known = Object.values(hostedDraftActivationFailureSteps).includes(step);
  const label = known ? step : hostedDraftActivationFailureSteps.bootstrap;
  return `Hosted draft activation refused at ${label}; no raw error output.\n`;
}

async function main() {
  let step = hostedDraftActivationFailureSteps.bootstrap;
  try {
    if (
      process.platform !== 'linux' ||
      process.geteuid() !== 0 ||
      process.argv.length !== 8
    )
      throw new Error();
    const [
      selfHash,
      runnerHash,
      identityPath,
      identityHash,
      manifestPath,
      manifestHash,
    ] = process.argv.slice(2);
    step = hostedDraftActivationFailureSteps.verifyInstalled;
    const input = await verifySmokeInputs({
      self: new URL('./managed-private-smoke.mjs', import.meta.url).pathname,
      runner: new URL('./managed-private-smoke-runner.mjs', import.meta.url)
        .pathname,
      selfHash,
      runnerHash,
      identityPath: resolve(identityPath),
      identityHash,
      manifestPath: resolve(manifestPath),
      manifestHash,
    });
    step = hostedDraftActivationFailureSteps.readNginxSource;
    const source = await readManagedNginxSource();
    step = hostedDraftActivationFailureSteps.activate;
    await runHostedDraftActivation(
      input,
      undefined,
      async ({ binding, evidence }) =>
        runManagedNginxActivation(
          {
            binding,
            input: { ...evidence, now: Date.now() },
            config: source.content,
          },
          createManagedNginxOwnerActions({ ...input, source }),
          { persistent: true }
        )
    );
  } catch {
    process.stderr.write(hostedDraftActivationFailureMessage(step));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
