import { beforeEach, describe, expect, it, vi } from 'vitest';
import { primaryWalletCardCheckoutFixture as fixture } from './primary-wallet-card-checkout.test-fixture';
import { createPrimaryWalletCardCheckoutExecutor } from './primary-wallet-card-checkout-executor';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  create: vi.fn(),
}));
vi.mock('pg', () => ({
  Client: class {
    constructor(options: unknown) {
      mocks.create(options);
    }
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
  },
}));
const config = {
  settings: fixture.settings,
  authorizer: { ...fixture.database, login: 'baci_primary_card_authorizer' },
  evidence: { ...fixture.database, login: 'baci_primary_card_evidence' },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
});
describe('restricted primary card database executor', () => {
  it.each([
    'authorizer',
    'evidence',
  ])('uses verified %s capability and TLS', async (role) => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            database_name: 'fixture',
            login_name: `baci_primary_card_${role}`,
            role_name: `baci_primary_card_${role}`,
            safe: true,
            tls: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ result: true }] });
    const execute = createPrimaryWalletCardCheckoutExecutor(config);
    expect(
      await (role === 'authorizer'
        ? execute('read', ['{}', fixture.intent.operationId])
        : execute('collection', ['{}', fixture.intent.operationId, '{}']))
    ).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user: `baci_primary_card_${role}`,
        ssl: { rejectUnauthorized: true, ca: 'fixture-ca' },
      })
    );
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([`primary_card_${role}`]);
    expect(mocks.end).toHaveBeenCalled();
  });
  it.each([
    { safe: false },
    { tls: false },
    { role_name: 'postgres' },
    { database_name: 'wrong' },
  ])('rejects an unsafe DB session %j before operation', async (override) => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          database_name: 'fixture',
          login_name: 'baci_primary_card_authorizer',
          role_name: 'baci_primary_card_authorizer',
          safe: true,
          tls: true,
          ...override,
        },
      ],
    });
    await expect(
      createPrimaryWalletCardCheckoutExecutor(config)('read', [
        '{}',
        fixture.intent.operationId,
      ])
    ).rejects.toThrow('Primary card storage unavailable');
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.end).toHaveBeenCalled();
  });
  it('rejects a malformed operation before connecting', async () => {
    await expect(
      createPrimaryWalletCardCheckoutExecutor(config)('read', [])
    ).rejects.toThrow();
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
