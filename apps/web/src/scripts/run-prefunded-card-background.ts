import 'server-only';
import { fstatSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { readPrefundedCardActivationConfig } from '@/lib/piggyvest/prefunded-card-activation-config-file';
import { createPrefundedCardBackgroundRunner } from '@/lib/piggyvest/prefunded-card-background-runner';
import { createPrefundedCardCheckoutRecoveryComposition } from '@/lib/piggyvest/prefunded-card-checkout-recovery-composition';
import { createPrefundedCardCheckoutRecoveryRunner } from '@/lib/piggyvest/prefunded-card-checkout-recovery-runner';
import { createPrefundedCardCheckoutRecoveryRunnerFileStore } from '@/lib/piggyvest/prefunded-card-checkout-recovery-runner-file-store';
import { createPrefundedCardComposition } from '@/lib/piggyvest/prefunded-card-composition';

const STATE_DIRECTORY = '/var/lib/baci-staging/prefunded-first-card';
const CONFIG_FILE = '/etc/baci-staging/prefunded-first-card.json';

function inheritedLockMatches(): boolean {
  try {
    if (process.env.PREFUNDED_CARD_BACKGROUND_LOCK_HELD !== '1') return false;
    const directory = lstatSync(STATE_DIRECTORY);
    const lock = lstatSync(join(STATE_DIRECTORY, 'runner.lock'));
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
  if (!inheritedLockMatches()) {
    console.log(JSON.stringify({ status: 'failed' }));
    process.exitCode = 1;
    return;
  }

  const loaded = await readPrefundedCardActivationConfig(CONFIG_FILE);
  if (!loaded.ok) {
    console.log(
      JSON.stringify({
        status: loaded.issues.some((issue) => issue.status === 'expired')
          ? 'expired'
          : 'failed',
      })
    );
    process.exitCode = 1;
    return;
  }

  try {
    const { configuration } = loaded;
    const source = loaded.source;
    if (
      typeof source !== 'object' ||
      source === null ||
      !('background' in source)
    )
      throw new Error('Background configuration unavailable');
    const scope = {
      ...configuration.recovery.scope,
      databaseName: configuration.expected.database,
    };
    const recovery = createPrefundedCardCheckoutRecoveryComposition({
      configuration: configuration.recovery,
      fetchImplementation: fetch,
    });
    const recoveryRunner = createPrefundedCardCheckoutRecoveryRunner({
      scope,
      recovery,
      stateStore:
        createPrefundedCardCheckoutRecoveryRunnerFileStore(STATE_DIRECTORY),
    });
    const composition = createPrefundedCardComposition({
      configuration: source.background,
      fetchImplementation: fetch,
    });
    const runner = createPrefundedCardBackgroundRunner({
      scope,
      expectedDatabaseName: configuration.expected.database,
      recovery: recoveryRunner,
      composition,
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
