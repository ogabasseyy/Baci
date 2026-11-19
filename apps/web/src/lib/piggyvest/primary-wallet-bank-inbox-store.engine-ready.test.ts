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

const worker = {
  ...fixture.config,
  database: { ...fixture.config.database, login: 'baci_primary_bank_worker' },
};
const session = (overrides: Record<string, unknown> = {}) => ({
  rows: [
    {
      database_name: worker.database.name,
      login_name: worker.database.login,
      role_name: worker.database.login,
      safe: true,
      capability_safe: true,
      tls: true,
      ...overrides,
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
});

it('asks the verified worker session for the bank-inbox surface only', async () => {
  mocks.query.mockResolvedValueOnce(session()).mockResolvedValueOnce({
    rows: [
      { result: { ready: false, missing: ['engine_readiness_not_installed'] } },
    ],
  });
  expect(await createPrimaryWalletBankInboxStore(worker).engineReady()).toEqual(
    { ready: false, missing: ['engine_readiness_not_installed'] }
  );
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(mocks.query.mock.calls[0]?.[1]).toEqual([
    'primary_bank_inbox_worker',
    true,
  ]);
  expect(mocks.query.mock.calls[1]).toEqual([
    'SELECT piggyvest_primary.engine_ready($1::text) AS result',
    ['bank_inbox'],
  ]);
  expect(mocks.end).toHaveBeenCalledOnce();
});

it('returns a ready verdict unchanged', async () => {
  mocks.query.mockResolvedValueOnce(session()).mockResolvedValueOnce({
    rows: [{ result: { ready: true, missing: [] } }],
  });
  expect(await createPrimaryWalletBankInboxStore(worker).engineReady()).toEqual(
    { ready: true, missing: [] }
  );
});

it('reports a readiness database error as not ready', async () => {
  mocks.query
    .mockResolvedValueOnce(session())
    .mockRejectedValueOnce(new Error('private database detail'));
  expect(await createPrimaryWalletBankInboxStore(worker).engineReady()).toEqual(
    { ready: false, missing: ['engine_readiness_unavailable'] }
  );
});

it('never asks through an unsafe worker session', async () => {
  mocks.query.mockResolvedValueOnce(session({ capability_safe: false }));
  await expect(
    createPrimaryWalletBankInboxStore(worker).engineReady()
  ).rejects.toThrow('database unavailable');
  expect(mocks.query).toHaveBeenCalledTimes(1);
});

it('is not an intake capability', async () => {
  await expect(
    createPrimaryWalletBankInboxStore(fixture.config).engineReady()
  ).rejects.toThrow('capability');
  expect(mocks.construct).not.toHaveBeenCalled();
});
