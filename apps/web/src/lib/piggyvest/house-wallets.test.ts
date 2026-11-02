import { describe, expect, it, vi } from 'vitest';
import {
  HOUSE_WALLET_ROLES,
  type HouseWalletQuery,
  readHouseWallets,
  resolveHouseWallets,
} from './house-wallets';

vi.mock('server-only', () => ({}));

const INTEGRATION_ID = 'e5e00000-0000-4000-8000-000000000005';

const wallet = (role: string, overrides: Record<string, unknown> = {}) => ({
  role,
  provider_wallet_id: `pv-house-${role}`,
  business_id: 'engine-business',
  currency: 'NGN',
  enabled: true,
  verified: true,
  ...overrides,
});

const allReady = () => [
  wallet('collection'),
  wallet('fee'),
  wallet('interest'),
];

describe('resolveHouseWallets', () => {
  it('is ready only when all three wallets are enabled and verified', () => {
    expect(resolveHouseWallets(allReady())).toEqual({
      status: 'ready',
      businessId: 'engine-business',
      wallets: {
        collection: {
          role: 'collection',
          providerWalletId: 'pv-house-collection',
          businessId: 'engine-business',
          currency: 'NGN',
        },
        interest: {
          role: 'interest',
          providerWalletId: 'pv-house-interest',
          businessId: 'engine-business',
          currency: 'NGN',
        },
        fee: {
          role: 'fee',
          providerWalletId: 'pv-house-fee',
          businessId: 'engine-business',
          currency: 'NGN',
        },
      },
    });
  });

  it('treats an unverified or disabled wallet as missing', () => {
    const result = resolveHouseWallets([
      wallet('collection'),
      wallet('interest', { verified: false, enabled: false }),
      wallet('fee', { enabled: false }),
    ]);
    expect(result).toEqual({
      status: 'incomplete',
      missing: ['interest', 'fee'],
      wallets: {
        collection: {
          role: 'collection',
          providerWalletId: 'pv-house-collection',
          businessId: 'engine-business',
          currency: 'NGN',
        },
      },
    });
  });

  it('reports every role missing when nothing is registered', () => {
    expect(resolveHouseWallets([])).toEqual({
      status: 'incomplete',
      missing: [...HOUSE_WALLET_ROLES],
      wallets: {},
    });
  });

  it('refuses a malformed response instead of guessing', () => {
    expect(
      resolveHouseWallets([wallet('collection', { enabled: 'yes' })])
    ).toEqual({
      status: 'unavailable',
      reason: 'invalid_response',
    });
    expect(resolveHouseWallets([wallet('main')])).toEqual({
      status: 'unavailable',
      reason: 'invalid_response',
    });
  });

  it('refuses a wallet that is not recorded as NGN, or has no currency', () => {
    for (const rows of [
      [wallet('collection', { currency: 'USD' })],
      [wallet('collection', { currency: undefined })],
    ]) {
      expect(resolveHouseWallets(rows)).toEqual({
        status: 'unavailable',
        reason: 'invalid_response',
      });
    }
  });

  it('refuses two rows for one role, one wallet for two roles, or two businesses', () => {
    for (const rows of [
      [
        wallet('collection'),
        wallet('collection', { provider_wallet_id: 'pv-other' }),
      ],
      [
        wallet('collection'),
        wallet('fee', { provider_wallet_id: 'pv-house-collection' }),
      ],
      [wallet('collection'), wallet('fee', { business_id: 'other-business' })],
    ]) {
      expect(resolveHouseWallets(rows)).toEqual({
        status: 'unavailable',
        reason: 'invalid_response',
      });
    }
  });
});

describe('readHouseWallets', () => {
  it('reads through the engine read helper with the integration id bound', async () => {
    const query = vi
      .fn<HouseWalletQuery>()
      .mockResolvedValue({ rows: allReady() });
    const result = await readHouseWallets(query, INTEGRATION_ID);
    expect(result.status).toBe('ready');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      'SELECT role, provider_wallet_id, business_id, currency, enabled, verified FROM piggyvest_primary.read_house_wallets($1::uuid)',
      [INTEGRATION_ID]
    );
  });

  it('fails closed when the query fails', async () => {
    const query = vi
      .fn<HouseWalletQuery>()
      .mockRejectedValue(new Error('connection refused'));
    await expect(readHouseWallets(query, INTEGRATION_ID)).resolves.toEqual({
      status: 'unavailable',
      reason: 'query_failed',
    });
  });

  it('rejects an integration id that is not a uuid before querying', async () => {
    const query = vi.fn<HouseWalletQuery>();
    await expect(readHouseWallets(query, 'integration-1')).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
