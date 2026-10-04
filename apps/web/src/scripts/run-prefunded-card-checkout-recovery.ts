import 'server-only';
import { fstatSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { prefundedCardCheckoutRecoveryRunnerStateSchemas as schemas } from '@/schemas/prefunded-card-checkout-recovery-runner-state';
import { createPrefundedCardCheckoutRecoveryComposition } from '@/lib/piggyvest/prefunded-card-checkout-recovery-composition';
import { createPrefundedCardCheckoutRecoveryRunner } from '@/lib/piggyvest/prefunded-card-checkout-recovery-runner';
import { createPrefundedCardCheckoutRecoveryRunnerFileStore } from '@/lib/piggyvest/prefunded-card-checkout-recovery-runner-file-store';

function inheritedLockMatches(stateDirectory: string): boolean {
  try {
    if (process.env.PREFUNDED_CARD_CHECKOUT_RECOVERY_LOCK_HELD !== '1')
      return false;
    const directory = lstatSync(stateDirectory);
    const lockPath = join(stateDirectory, 'runner.lock');
    const lock = lstatSync(lockPath);
    const inherited = fstatSync(9);
    const owner = typeof process.getuid === 'function' ? process.getuid() : -1;
    return (
      directory.isDirectory() &&
      !directory.isSymbolicLink() &&
      (directory.mode & 0o7777) === 0o700 &&
      directory.uid === owner &&
      lock.isFile() &&
      !lock.isSymbolicLink() &&
      (lock.mode & 0o7777) === 0o600 &&
      lock.nlink === 1 &&
      lock.uid === owner &&
      inherited.isFile() &&
      (inherited.mode & 0o7777) === 0o600 &&
      inherited.nlink === 1 &&
      inherited.uid === owner &&
      inherited.dev === lock.dev &&
      inherited.ino === lock.ino
    );
  } catch {
    return false;
  }
}

async function main() {
  const raw = process.env.PREFUNDED_CARD_CHECKOUT_RECOVERY_RUNNER_CONFIG;
  if (!raw || raw.length > 65_536) {
    console.log(JSON.stringify({ status: 'failed' }));
    process.exitCode = 1;
    return;
  }

  try {
    const configuration = schemas.cliConfiguration.parse(JSON.parse(raw));
    if (!inheritedLockMatches(configuration.stateDirectory))
      throw new Error('runner lock required');
    const recovery = createPrefundedCardCheckoutRecoveryComposition({
      configuration: configuration.recovery,
      fetchImplementation: fetch,
    });
    const stateStore = createPrefundedCardCheckoutRecoveryRunnerFileStore(
      configuration.stateDirectory
    );
    const runner = createPrefundedCardCheckoutRecoveryRunner({
      scope: configuration.scope,
      recovery,
      stateStore,
    });
    const result = await runner.run();
    console.log(JSON.stringify(result));
    if (result.status === 'failed' || result.status === 'expired')
      process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ status: 'failed' }));
    process.exitCode = 1;
  }
}

void main();
