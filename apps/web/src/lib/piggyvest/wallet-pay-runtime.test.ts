import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readWalletPayRecoveryRuntime,
  readWalletPayRuntime,
} from './wallet-pay-runtime';

vi.mock('server-only', () => ({}));
const recovery = vi.hoisted(() => vi.fn());
vi.mock('./primary-wallet-savings-runtime', () => ({
  readPrimaryWalletSavingsRecoveryRuntime: recovery,
}));

const base = {
  configuration: { integrationId: 'i', environment: 'staging' },
  reconciliationConfiguration: { integrationId: 'i', environment: 'staging' },
  merchantId: 'm',
  businessId: 'b',
  providerToken: 't',
};
const on = {
  PIGGYVEST_PRIMARY_ENABLED: 'true',
  PIGGYVEST_WALLET_PAY_ENABLED: 'true',
  PIGGYVEST_COLLECTION_WALLET_ID: 'collection-wallet',
};

beforeEach(() => {
  recovery.mockReset();
  recovery.mockReturnValue(base);
});

describe('readWalletPayRuntime (new payments)', () => {
  it('is off by default', () => {
    expect(readWalletPayRuntime({})).toBeNull();
    expect(recovery).not.toHaveBeenCalled();
  });

  it('is off unless both the wallet and wallet pay flags are exactly "true"', () => {
    expect(
      readWalletPayRuntime({ ...on, PIGGYVEST_PRIMARY_ENABLED: 'false' })
    ).toBeNull();
    expect(
      readWalletPayRuntime({ ...on, PIGGYVEST_WALLET_PAY_ENABLED: '1' })
    ).toBeNull();
  });

  it('stops under the master kill switch', () => {
    expect(
      readWalletPayRuntime({ ...on, PIGGYVEST_KILL_SWITCH: 'true' })
    ).toBeNull();
  });

  it('returns the runtime with the server-configured collection wallet when on', () => {
    expect(readWalletPayRuntime(on)).toEqual({
      ...base,
      collectionWalletId: 'collection-wallet',
    });
  });

  it('fails loudly when on without a collection wallet', () => {
    expect(() =>
      readWalletPayRuntime({ ...on, PIGGYVEST_COLLECTION_WALLET_ID: undefined })
    ).toThrow();
  });
});

describe('readWalletPayRecoveryRuntime (status, settlement, delivery, refunds)', () => {
  it('ignores the flags and the kill switch so accepted money is never stranded', () => {
    expect(
      readWalletPayRecoveryRuntime({
        PIGGYVEST_KILL_SWITCH: 'true',
        PIGGYVEST_COLLECTION_WALLET_ID: 'collection-wallet',
      })
    ).toEqual({ ...base, collectionWalletId: 'collection-wallet' });
  });

  it('fails loudly when PiggyVest is misconfigured, so a refund drain pages instead of skipping', () => {
    recovery.mockImplementation(() => {
      throw new Error('Primary savings configuration unavailable');
    });
    expect(() =>
      readWalletPayRecoveryRuntime({ PIGGYVEST_COLLECTION_WALLET_ID: 'c' })
    ).toThrow();
    recovery.mockReturnValue(base);
    expect(() => readWalletPayRecoveryRuntime({})).toThrow();
  });
});
