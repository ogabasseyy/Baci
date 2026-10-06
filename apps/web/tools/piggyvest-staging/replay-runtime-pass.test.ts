import { afterEach, expect, it, vi } from 'vitest';

const run = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ resolutionFailures: 0 })
);
const interest = vi.hoisted(() => vi.fn());
const accrual = vi.hoisted(() => vi.fn(() => vi.fn()));
const outflowDispatch = vi.hoisted(() =>
  vi.fn().mockRejectedValue(new Error('outflow adapter called'))
);
const outflow = vi.hoisted(() => vi.fn(() => outflowDispatch));
const outflowStore = vi.hoisted(() => vi.fn(() => vi.fn()));
vi.mock('./replay-accrual-runtime', () => ({ createAccrualReplay: accrual }));
vi.mock('./replay-interest-runtime', () => ({
  createInterestReplay: vi.fn(() => interest),
}));
vi.mock('./replay-outflow-runtime', () => ({ createOutflowReplay: outflow }));
vi.mock('./transfer-outbox-finality', () => ({
  createDurableOutflowStore: outflowStore,
}));
vi.mock('./replay-financial-postgres', () => ({
  createFinancialReplayPostgres: vi.fn(() => vi.fn()),
}));
vi.mock('./replay-run', () => ({ runReplayPass: run }));
vi.mock('./replay-private-fetch', () => ({
  createPrivateReplayFetch: vi.fn(() => vi.fn()),
}));

import { runConfiguredReplayPass } from './replay-runtime-pass';

afterEach(() => vi.clearAllMocks());
const token = (role: string) => {
  const now = Math.floor(Date.now() / 1000);
  return `header.${Buffer.from(JSON.stringify({ role, iat: now, exp: now + 3600 })).toString('base64url')}.signature`;
};
const config = {
  environment: 'staging',
  receiptToken: token('pvb_staging_worker'),
  appToken: token('pvb_staging_app_worker'),
  receiptKey: Buffer.alloc(32, 1).toString('base64'),
  receiptSystemId: '7686901100561231906',
  appSystemId: '7685292944002592802',
};

it('uses private transports, exact identities and a single bounded batch', async () => {
  await runConfiguredReplayPass(config);
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      argv: ['--limit', '10', '--max-receipts', '10', '--lease-seconds', '300'],
      receiptFetch: expect.any(Function),
      appFetch: expect.any(Function),
      env: expect.objectContaining({
        PVB_STAGING_POSTGREST_URL: 'http://127.0.0.1:4792',
        PVB_STAGING_APP_URL: 'http://127.0.0.1:4793',
        PVB_STAGING_EXPECTED_APP_SYSTEM_ID: config.appSystemId,
      }),
    })
  );
});

it('refuses invalid configuration before any claim', async () => {
  await expect(
    runConfiguredReplayPass({ ...config, environment: 'production' })
  ).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});

it('passes only an explicitly injected prefunded callback bundle to the bounded runner', async () => {
  const prefundedReplay = {
    resolveEnrollment: vi.fn(async () => 'enrolled'),
    readOriginalSignature: vi.fn(async () => null),
    replay: vi.fn(async () => ({ outcome: 'retry', stage: 'evidence' })),
  };
  await runConfiguredReplayPass(config, { prefundedReplay });
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ prefundedReplay })
  );
  expect(prefundedReplay.resolveEnrollment).not.toHaveBeenCalled();
  expect(prefundedReplay.readOriginalSignature).not.toHaveBeenCalled();
  expect(prefundedReplay.replay).not.toHaveBeenCalled();
});

it('refuses enabled replay without its loaded callbacks before any claim', async () => {
  await expect(
    runConfiguredReplayPass({
      ...config,
      prefundedReplay: {
        bundleSha256: 'a'.repeat(64),
        configurationSha256: 'b'.repeat(64),
      },
    })
  ).rejects.toThrow('Configured prefunded replay is unavailable');
  expect(run).not.toHaveBeenCalled();
});

it('wires the loaded replay callbacks when the runtime is explicitly enabled', async () => {
  const prefundedReplay = {
    resolveEnrollment: vi.fn(async () => 'legacy'),
    replay: vi.fn(async () => ({ outcome: 'not_applicable' })),
  };
  await runConfiguredReplayPass(
    {
      ...config,
      prefundedReplay: {
        bundleSha256: 'a'.repeat(64),
        configurationSha256: 'b'.repeat(64),
      },
    },
    { prefundedReplay }
  );
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ prefundedReplay })
  );
  expect(prefundedReplay.resolveEnrollment).not.toHaveBeenCalled();
});

it('wires the explicit restricted financial connection into the receipt worker', async () => {
  await runConfiguredReplayPass({
    ...config,
    financialDatabase: {
      host: 'baci-isolated-savings-db-1',
      port: 5432,
      database: 'postgres',
      role: 'piggyvest_staging_ledger_worker',
      password: 'synthetic-password',
      integrationId: '40000000-0000-4000-8000-000000000001',
      businessId: 'business',
    },
  });
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ dispatchFinancial: expect.any(Function) })
  );
});

it('wires signed accrual observations only when the explicit verification credential is present', async () => {
  const database = {
    host: 'baci-isolated-savings-db-1',
    port: 5432,
    database: 'postgres',
    role: 'piggyvest_staging_ledger_worker',
    password: 'synthetic-password',
    integrationId: '40000000-0000-4000-8000-000000000001',
    businessId: 'business',
  };
  await runConfiguredReplayPass({ ...config, financialDatabase: database });
  expect(run.mock.calls.at(-1)?.[0].accrualReplay).toBeUndefined();
  await runConfiguredReplayPass({
    ...config,
    financialDatabase: database,
    interestAccrualSigningSecret: 'synthetic-interest-secret',
  });
  expect(run.mock.calls.at(-1)?.[0].accrualReplay).toEqual(
    expect.any(Function)
  );
});

it('keeps the treasury role on paid-interest dispatch only', async () => {
  const financialDatabase = {
    host: 'piggyvest-db.staging.baci.internal',
    port: 5432,
    database: 'postgres',
    role: 'prefunded_treasury_operator',
    password: 'synthetic-password',
    integrationId: '40000000-0000-4000-8000-000000000001',
    businessId: 'business',
    ssl: { ca: 'synthetic-ca' },
  };

  await runConfiguredReplayPass({ ...config, financialDatabase });

  const adapters = run.mock.calls.at(-1)?.[0];
  expect(adapters.accrualReplay).toBeUndefined();
  expect(adapters.dispatchFinancial).toEqual(expect.any(Function));
  expect(run.mock.calls.at(-1)?.[0].allowLegacyInflow).toBe(false);
  await adapters.dispatchFinancial({
    event: { eventType: 'interest-payout.success' },
  });
  expect(() =>
    adapters.dispatchFinancial({ event: { eventType: 'unsupported.success' } })
  ).toThrow('Financial replay deferred');
  expect(accrual).not.toHaveBeenCalled();
  expect(outflow).not.toHaveBeenCalled();
  expect(outflowStore).not.toHaveBeenCalled();
  expect(outflowDispatch).not.toHaveBeenCalled();
});

it('refuses injected prefunded callbacks in treasury mode even without a config activation', async () => {
  const financialDatabase = {
    host: 'piggyvest-db.staging.baci.internal',
    port: 5432,
    database: 'postgres',
    role: 'prefunded_treasury_operator',
    password: 'synthetic-password',
    integrationId: '40000000-0000-4000-8000-000000000001',
    businessId: 'business',
    ssl: { ca: 'synthetic-ca' },
  };
  const prefundedReplay = {
    resolveEnrollment: vi.fn(async () => 'enrolled' as const),
    replay: vi.fn(async () => ({
      outcome: 'retry' as const,
      stage: 'evidence',
    })),
  };

  await expect(
    runConfiguredReplayPass(
      { ...config, financialDatabase },
      { prefundedReplay }
    )
  ).rejects.toThrow(
    'Prefunded bank replay is unavailable in paid-interest-only mode'
  );
  expect(run).not.toHaveBeenCalled();
  expect(prefundedReplay.replay).not.toHaveBeenCalled();
});

it('fails the pass when receipt state transitions were not durable', async () => {
  run.mockResolvedValueOnce({ resolutionFailures: 1 });
  await expect(runConfiguredReplayPass(config)).rejects.toThrow(
    'Staging replay resolution failed'
  );
});

it('backs off a retryable pass instead of marking processing healthy', async () => {
  run.mockResolvedValueOnce({ resolutionFailures: 0, retryable: 1 });
  await expect(runConfiguredReplayPass(config)).rejects.toThrow(
    'Staging replay deferred'
  );
});
