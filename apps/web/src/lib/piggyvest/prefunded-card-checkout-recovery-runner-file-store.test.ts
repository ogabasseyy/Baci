import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrefundedCardCheckoutRecoveryRunnerFileStore } from './prefunded-card-checkout-recovery-runner-file-store';

vi.mock('server-only', () => ({}));

const scope = {
  deployment: 'staging',
  integrationId: '10000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000002',
  treasuryBindingId: '10000000-0000-4000-8000-000000000003',
  businessId: 'business_staging',
  systemIdentifier: '7685292944002592802',
  expiresAt: '2026-09-29T15:59:10Z',
  databaseName: 'baci_staging',
} as const;
const first = {
  createdAt: '2026-09-27T12:00:00.000Z',
  intentId: '30000000-0000-4000-8000-000000000001',
};
const token = '20000000-0000-4000-8000-000000000001';
let directory = '';

async function setupDirectory() {
  directory = await mkdtemp(join(tmpdir(), 'baci-recovery-state-'));
  await chmod(directory, 0o700);
  return directory;
}

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

describe('prefunded first-card recovery runner file store', () => {
  it('atomically persists a cursor that a fresh process can resume after a crash', async () => {
    const stateDirectory = await setupDirectory();
    const store =
      createPrefundedCardCheckoutRecoveryRunnerFileStore(stateDirectory);
    await store.acquire({ scope, token });
    await store.commit({ scope, token, cursor: first });

    const restarted =
      createPrefundedCardCheckoutRecoveryRunnerFileStore(stateDirectory);
    await expect(
      restarted.acquire({
        scope,
        token: '20000000-0000-4000-8000-000000000002',
      })
    ).resolves.toMatchObject({ cursor: first, scope });
  });

  it('keeps the previous checkpoint when a process exits before commit', async () => {
    const stateDirectory = await setupDirectory();
    const firstProcess =
      createPrefundedCardCheckoutRecoveryRunnerFileStore(stateDirectory);
    await firstProcess.acquire({ scope, token });
    await firstProcess.commit({ scope, token, cursor: first });

    const crashedProcess =
      createPrefundedCardCheckoutRecoveryRunnerFileStore(stateDirectory);
    await crashedProcess.acquire({
      scope,
      token: '20000000-0000-4000-8000-000000000002',
    });
    const restarted =
      createPrefundedCardCheckoutRecoveryRunnerFileStore(stateDirectory);
    await expect(
      restarted.acquire({
        scope,
        token: '20000000-0000-4000-8000-000000000003',
      })
    ).resolves.toMatchObject({ cursor: first });
  });

  it('fails closed on corrupt or cross-scope checkpoint contents', async () => {
    const stateDirectory = await setupDirectory();
    const key = createHash('sha256')
      .update(JSON.stringify(scope))
      .digest('hex');
    const path = join(stateDirectory, `${key}.json`);
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        scope: { ...scope, merchantId: '10000000-0000-4000-8000-000000000099' },
        cursor: null,
      }),
      { mode: 0o600 }
    );
    const store =
      createPrefundedCardCheckoutRecoveryRunnerFileStore(stateDirectory);
    await expect(store.acquire({ scope, token })).rejects.toThrow(
      'First-card recovery runner unavailable'
    );
  });

  it('refuses a directory not private to the current user', async () => {
    const stateDirectory = await setupDirectory();
    await chmod(stateDirectory, 0o750);
    const store =
      createPrefundedCardCheckoutRecoveryRunnerFileStore(stateDirectory);
    await expect(store.acquire({ scope, token })).rejects.toThrow(
      'First-card recovery runner unavailable'
    );
  });
});
