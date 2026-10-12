import { beforeEach, expect, it, vi } from 'vitest';
import { paidInterestFixture as fixture } from './primary-wallet-paid-interest.test-support';
import { createPrimaryWalletPaidInterestInboxStore } from './primary-wallet-paid-interest-inbox-store';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  construct: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({
  Client: class {
    constructor(config: unknown) {
      mocks.construct(config);
    }
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
  },
}));
const session = {
  database_name: 'postgres',
  login_name: fixture.config.database.login,
  role_name: fixture.config.database.login,
  safe: true,
  tls: true,
};
const { providerToken: _providerToken, ...configuration } = fixture.config;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (statement: string) => ({
    rows: [
      {
        ...(statement.includes('pg_stat_ssl')
          ? session
          : { result: 'accepted' }),
      },
    ],
  }));
});
it('persists through only environment-bound parameterized restricted TLS intake', async () => {
  const command = { rawHex: 'ff', signature: 'a'.repeat(128) };
  expect(
    await createPrimaryWalletPaidInterestInboxStore(configuration).enqueue(
      command
    )
  ).toBe('accepted');
  expect(mocks.query).toHaveBeenLastCalledWith(
    'SELECT piggyvest_primary.enqueue_paid_interest_inbox($1::uuid,$2::text,$3::jsonb) AS result',
    [fixture.config.integrationId, 'production', JSON.stringify(command)]
  );
  expect(mocks.construct).toHaveBeenCalledWith(
    expect.objectContaining({
      ssl: { rejectUnauthorized: true, ca: 'test-only-ca' },
    })
  );
});
it('claims through the bounded entrypoint', async () => {
  mocks.query.mockImplementation(async (statement: string) => ({
    rows: [
      { ...(statement.includes('pg_stat_ssl') ? session : { result: [] }) },
    ],
  }));
  expect(
    await createPrimaryWalletPaidInterestInboxStore(configuration).claim({
      batchSize: 5,
    })
  ).toEqual([]);
  expect(mocks.query).toHaveBeenLastCalledWith(
    expect.stringContaining('claim_paid_interest_inbox'),
    [fixture.config.integrationId, 'production', '{"batchSize":5}']
  );
});
it('requires positive restricted finish acknowledgement', async () => {
  mocks.query.mockImplementation(async (statement: string) => ({
    rows: [
      { ...(statement.includes('pg_stat_ssl') ? session : { result: false }) },
    ],
  }));
  await expect(
    createPrimaryWalletPaidInterestInboxStore(configuration).finish({
      eventId: 'event',
      token: fixture.config.integrationId,
      outcome: 'credited',
    })
  ).rejects.toThrow();
});
it.each([
  { ...session, tls: false },
  { ...session, safe: false },
  { ...session, role_name: 'service_role' },
])('rejects unsafe sessions before storage', async (unsafe) => {
  mocks.query.mockResolvedValue({ rows: [unsafe] });
  await expect(
    createPrimaryWalletPaidInterestInboxStore(configuration).claim({
      batchSize: 1,
    })
  ).rejects.toThrow('database unavailable');
  expect(mocks.query).toHaveBeenCalledOnce();
});
it('does not leak errors or retry uncertain durable intake', async () => {
  mocks.connect.mockRejectedValue(new Error('secret database failure'));
  await expect(
    createPrimaryWalletPaidInterestInboxStore(configuration).enqueue({
      rawHex: 'ff',
      signature: 'a'.repeat(128),
    })
  ).rejects.toThrow('Primary interest inbox database unavailable');
  expect(mocks.connect).toHaveBeenCalledOnce();
  expect(mocks.end).toHaveBeenCalledOnce();
});
