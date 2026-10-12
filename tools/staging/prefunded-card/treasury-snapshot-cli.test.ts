import { beforeEach, expect, it, vi } from 'vitest';
import { readPrefundedCardTreasurySnapshotConfig } from '../../../apps/web/src/lib/piggyvest/prefunded-card-treasury-snapshot-config-file';
import { createPrefundedCardTreasurySnapshotStore } from '../../../apps/web/src/lib/piggyvest/prefunded-card-treasury-snapshot-store';
import { verifyPrefundedCardTreasurySnapshot } from '../../../apps/web/src/lib/piggyvest/prefunded-card-treasury-verifier';
import { prefundedCardTreasurySnapshotConfigSchema } from '../../../apps/web/src/schemas/prefunded-card-treasury-snapshot-config';
import { runPrefundedCardTreasurySnapshotCli } from './treasury-snapshot-cli';

vi.mock('server-only', () => ({}));
vi.mock(
  '../../../apps/web/src/lib/piggyvest/prefunded-card-treasury-snapshot-config-file'
);
vi.mock(
  '../../../apps/web/src/lib/piggyvest/prefunded-card-treasury-snapshot-store'
);
vi.mock('../../../apps/web/src/lib/piggyvest/prefunded-card-treasury-verifier');

const configuration = prefundedCardTreasurySnapshotConfigSchema.parse({
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
      apiSecret: 'synthetic-provider-secret',
      expectedBusinessId: '01M2381RG34HQJMHQKE7DWDACR',
      expectedCurrency: 'NGN',
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
});
const close = vi.fn(async () => undefined);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readPrefundedCardTreasurySnapshotConfig).mockResolvedValue({
    ok: true,
    configuration,
  });
  vi.mocked(createPrefundedCardTreasurySnapshotStore).mockReturnValue({
    store: {
      verifyTreasuryBinding: vi.fn(),
      readDatabaseTime: vi.fn(),
      recordImmutableSnapshotWithDatabaseAssignedSequence: vi.fn(),
    },
    close,
  });
});

it('emits only a fixed allowlisted refusal reason when config is missing', async () => {
  const output: string[] = [];

  const exitCode = await runPrefundedCardTreasurySnapshotCli({
    writeLine: (line) => output.push(line),
  });

  expect(exitCode).toBe(1);
  expect(output).toEqual([
    '{"outcome":"refused","reason":"invalid_configuration"}',
  ]);
  expect(createPrefundedCardTreasurySnapshotStore).not.toHaveBeenCalled();
});

it.each([
  'recorded',
  'duplicate',
] as const)('returns success only after a %s verification and closes the adapter', async (outcome) => {
  vi.mocked(verifyPrefundedCardTreasurySnapshot).mockResolvedValue({
    outcome,
    evidenceId: `pvts_${'a'.repeat(64)}`,
  });
  const output: string[] = [];

  const exitCode = await runPrefundedCardTreasurySnapshotCli({
    configPath: '/private/synthetic.json',
    writeLine: (line) => output.push(line),
  });

  expect(exitCode).toBe(0);
  expect(output).toEqual([JSON.stringify({ outcome })]);
  expect(close).toHaveBeenCalledOnce();
});

it('preserves a verifier refusal without logging configuration', async () => {
  vi.mocked(verifyPrefundedCardTreasurySnapshot).mockResolvedValue({
    outcome: 'refused',
    reason: 'provider_identity_mismatch',
  });
  const output: string[] = [];

  const exitCode = await runPrefundedCardTreasurySnapshotCli({
    configPath: '/private/synthetic.json',
    writeLine: (line) => output.push(line),
  });

  expect(exitCode).toBe(1);
  expect(output).toEqual([
    '{"outcome":"refused","reason":"provider_identity_mismatch"}',
  ]);
  expect(close).toHaveBeenCalledOnce();
});

it.each([
  'verification',
  'close',
] as const)('fails closed without exposing an exception during %s', async (failure) => {
  vi.mocked(verifyPrefundedCardTreasurySnapshot).mockResolvedValue({
    outcome: 'recorded',
    evidenceId: `pvts_${'a'.repeat(64)}`,
  });
  if (failure === 'verification') {
    vi.mocked(verifyPrefundedCardTreasurySnapshot).mockRejectedValue(
      new Error('synthetic-sensitive-provider-data')
    );
  } else {
    close.mockRejectedValue(new Error('synthetic-sensitive-provider-data'));
  }
  const output: string[] = [];

  const exitCode = await runPrefundedCardTreasurySnapshotCli({
    configPath: '/private/synthetic.json',
    writeLine: (line) => output.push(line),
  });

  expect(exitCode).toBe(1);
  expect(output).toEqual([
    '{"outcome":"refused","reason":"snapshot_store_unavailable"}',
  ]);
  expect(close).toHaveBeenCalledOnce();
});
