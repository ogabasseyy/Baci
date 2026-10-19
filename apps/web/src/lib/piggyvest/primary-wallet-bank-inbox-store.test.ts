import { beforeEach, expect, it, vi } from 'vitest';
import { primaryBankInboxFixture as fixture } from './primary-wallet-bank-inbox.test-fixture';
import { createPrimaryWalletBankInboxStore } from './primary-wallet-bank-inbox-store';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  construct: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({
  Client: class {
    constructor(options: unknown) {
      mocks.construct(options);
    }
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  mocks.query
    .mockResolvedValueOnce({
      rows: [
        {
          database_name: fixture.config.database.name,
          login_name: fixture.config.database.login,
          role_name: fixture.config.database.login,
          safe: true,
          capability_safe: true,
          tls: true,
        },
      ],
    })
    .mockResolvedValue({ rows: [{ result: 'accepted' }] });
});
it('pins TLS, least-privilege session and scoped intake parameters without financial statements', async () => {
  const command = {
    rawHex: fixture.claim.rawHex,
    signature: fixture.signature,
  };
  expect(
    await createPrimaryWalletBankInboxStore(fixture.config).enqueue(command)
  ).toBe('accepted');
  expect(mocks.construct).toHaveBeenCalledWith(
    expect.objectContaining({
      ssl: {
        rejectUnauthorized: true,
        ca: fixture.config.database.certificateAuthority,
      },
    })
  );
  expect(mocks.query.mock.calls[1]).toEqual([
    'SELECT piggyvest_primary.enqueue_bank_inbox($1::uuid,$2::text,$3::jsonb,$4::jsonb) AS result',
    [
      fixture.config.integrationId,
      fixture.config.environment,
      JSON.stringify(fixture.config.scope),
      JSON.stringify(command),
    ],
  ]);
  expect(mocks.end).toHaveBeenCalled();
});
it('rejects intake-to-worker and worker-to-intake commands before connecting', async () => {
  await expect(
    createPrimaryWalletBankInboxStore(fixture.config).claim({ batchSize: 1 })
  ).rejects.toThrow('capability');
  await expect(
    createPrimaryWalletBankInboxStore({
      ...fixture.config,
      database: {
        ...fixture.config.database,
        login: 'baci_primary_bank_worker',
      },
    }).enqueue({ rawHex: fixture.claim.rawHex, signature: fixture.signature })
  ).rejects.toThrow('capability');
  expect(mocks.construct).not.toHaveBeenCalled();
});
it.each([
  'safe',
  'tls',
  'capability_safe',
] as const)('fails closed on unsafe %s without credit or secret/error disclosure', async (key) => {
  mocks.query.mockReset().mockResolvedValue({
    rows: [
      {
        database_name: fixture.config.database.name,
        login_name: fixture.config.database.login,
        role_name: fixture.config.database.login,
        safe: true,
        capability_safe: true,
        tls: true,
        [key]: false,
      },
    ],
  });
  await expect(
    createPrimaryWalletBankInboxStore(fixture.config).readiness()
  ).rejects.toThrow('database unavailable');
  expect(mocks.query).toHaveBeenCalledTimes(1);
});
it('never accepts a false or malformed acknowledgement as durable readiness', async () => {
  mocks.query.mockResolvedValue({ rows: [{ result: false }] });
  await expect(
    createPrimaryWalletBankInboxStore(fixture.config).readiness()
  ).rejects.toThrow();
});
