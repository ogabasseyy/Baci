import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPrefundedCardTreasurySnapshotConfig } from './prefunded-card-treasury-snapshot-config-file';

vi.mock('server-only', () => ({}));

const configuration = {
  scope: {
    integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
    merchantId: '10000000-0000-4000-8000-000000000001',
  },
  verifier: {
    environment: 'staging',
    systemIdentifier: '7685292944002592802',
    expiresAt: '2026-09-29T15:59:10Z',
    treasuryBindingId: 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
    expectedBusinessId: '01M2381RG34HQJMHQKE7DWDACR',
    sourceWalletId: '01M238A0V75387H4HZ15YFWGX3',
    piggyvest: {
      apiBaseUrl: 'https://staging.piggyvest.business',
      apiSecret: 'synthetic-provider-secret',
      expectedBusinessId: '01M2381RG34HQJMHQKE7DWDACR',
      expectedCurrency: 'NGN',
      timeoutMs: 500,
      maxResponseBytes: 1024,
    },
  },
  database: {
    environment: 'staging',
    transport: 'tls',
    host: 'piggyvest-db.staging.baci.internal',
    expectedHost: 'piggyvest-db.staging.baci.internal',
    port: 5432,
    login: 'prefunded_snapshot_verifier',
    expectedLogin: 'prefunded_snapshot_verifier',
    database: 'postgres',
    expectedDatabase: 'postgres',
    expectedSystemId: '7685292944002592802',
    certificateAuthority: 'synthetic-ca-pem',
    password: 'A'.repeat(64),
  },
};

let directory: string;

async function createPrivateConfig(value: unknown = configuration) {
  directory = await mkdtemp(join(tmpdir(), 'prefunded-snapshot-config-'));
  const filePath = join(directory, 'config.json');
  await writeFile(filePath, JSON.stringify(value), { mode: 0o600 });
  await chmod(filePath, 0o600);
  return filePath;
}

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('readPrefundedCardTreasurySnapshotConfig', () => {
  it('loads an owner-owned 0600 config without emitting its secrets', async () => {
    const result = await readPrefundedCardTreasurySnapshotConfig(
      await createPrivateConfig()
    );

    expect(result).toEqual({ ok: true, configuration });
  });

  it('rejects group-readable configuration', async () => {
    const filePath = await createPrivateConfig();
    await chmod(filePath, 0o640);

    expect(await readPrefundedCardTreasurySnapshotConfig(filePath)).toEqual({
      ok: false,
    });
  });

  it('rejects symbolic links', async () => {
    const target = await createPrivateConfig();
    const link = join(directory, 'linked.json');
    await symlink(target, link);

    expect(await readPrefundedCardTreasurySnapshotConfig(link)).toEqual({
      ok: false,
    });
  });

  it('rejects files larger than 128 KiB without exposing contents', async () => {
    const filePath = await createPrivateConfig({
      padding: 'x'.repeat(131_072),
    });

    expect(await readPrefundedCardTreasurySnapshotConfig(filePath)).toEqual({
      ok: false,
    });
  });

  it('rejects invalid JSON without returning parser details', async () => {
    const filePath = await createPrivateConfig();
    await writeFile(filePath, 'synthetic-provider-secret', { mode: 0o600 });

    expect(await readPrefundedCardTreasurySnapshotConfig(filePath)).toEqual({
      ok: false,
    });
  });
});
