import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrimaryWalletExecutor } from './primary-wallet-executor';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';
import { PRIMARY_WALLET_VERIFICATION_STATEMENT } from './primary-wallet-verification';

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
const config = {
  onboarding: {
    environment: 'production',
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
    businessId: 'test-business',
    businessBindingVerified: true,
    fingerprintKey: 'test-only-fingerprint-key-not-a-real-secret',
  },
  providerToken: 'test-only-token',
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_primary_provisioner',
    password: 'test-only-password',
    certificateAuthority: 'test-only-ca',
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (statement: string) =>
    statement.includes('pg_stat_ssl')
      ? {
          rows: [
            {
              database_name: 'postgres',
              login_name: config.database.login,
              role_name: config.database.login,
              safe: true,
              tls: true,
            },
          ],
        }
      : { rows: [{ result: { status: 'pending' } }] }
  );
});
describe('primary wallet restricted executor', () => {
  it('permits only the fixed verification RPC with its two bound arguments', async () => {
    await createPrimaryWalletExecutor(config)(
      PRIMARY_WALLET_VERIFICATION_STATEMENT,
      ['{}', '{}']
    );
    expect(mocks.query).toHaveBeenLastCalledWith(
      PRIMARY_WALLET_VERIFICATION_STATEMENT,
      ['{}', '{}']
    );
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });
  it('rejects arbitrary SQL before opening a connection', async () => {
    await expect(
      createPrimaryWalletExecutor(config)('SELECT * FROM public.customers', [])
    ).rejects.toThrow('Primary wallet database unavailable');
    expect(mocks.construct).not.toHaveBeenCalled();
  });
  it('verifies TLS and restricted identity before executing a claim', async () => {
    await expect(
      createPrimaryWalletExecutor(config)(PRIMARY_WALLET_STATEMENTS.claim, [
        '{}',
        'a'.repeat(64),
      ])
    ).resolves.toEqual({ rows: [{ result: { status: 'pending' } }] });
    expect(mocks.construct).toHaveBeenCalledWith(
      expect.objectContaining({
        ssl: { rejectUnauthorized: true, ca: 'test-only-ca' },
        user: config.database.login,
      })
    );
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it('refuses an unsafe or unexpected database session', async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          database_name: 'postgres',
          login_name: 'postgres',
          role_name: 'postgres',
          safe: false,
          tls: true,
        },
      ],
    });
    await expect(
      createPrimaryWalletExecutor(config)(PRIMARY_WALLET_STATEMENTS.claim, [
        '{}',
        'a'.repeat(64),
      ])
    ).rejects.toThrow('Primary wallet database unavailable');
    expect(mocks.query).not.toHaveBeenCalledWith(
      PRIMARY_WALLET_STATEMENTS.claim,
      expect.anything()
    );
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it('does not expose connection errors or retry ambiguous writes', async () => {
    mocks.connect.mockRejectedValue(new Error('private password detail'));
    await expect(
      createPrimaryWalletExecutor(config)(PRIMARY_WALLET_STATEMENTS.claim, [
        '{}',
        'a'.repeat(64),
      ])
    ).rejects.toThrow('Primary wallet database unavailable');
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
