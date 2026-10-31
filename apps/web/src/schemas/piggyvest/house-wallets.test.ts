import { describe, expect, it } from 'vitest';
import {
  houseWalletIntegrationIdSchema,
  houseWalletRowSchema,
  houseWalletRowsSchema,
} from './house-wallets';

const row = {
  role: 'collection',
  provider_wallet_id: 'pv-house-collection',
  business_id: 'engine-business',
  enabled: true,
  verified: true,
};

describe('houseWalletRowSchema', () => {
  it('accepts a row returned by read_house_wallets', () => {
    expect(houseWalletRowSchema.parse(row)).toEqual(row);
  });

  it('refuses a role that is not a house wallet role', () => {
    expect(
      houseWalletRowSchema.safeParse({ ...row, role: 'main' }).success
    ).toBe(false);
  });

  it('refuses empty or oversized wallet and business ids', () => {
    expect(
      houseWalletRowSchema.safeParse({ ...row, provider_wallet_id: '' }).success
    ).toBe(false);
    expect(
      houseWalletRowSchema.safeParse({ ...row, business_id: 'b'.repeat(513) })
        .success
    ).toBe(false);
  });

  it('refuses unknown fields and non-boolean readiness', () => {
    expect(houseWalletRowSchema.safeParse({ ...row, extra: 1 }).success).toBe(
      false
    );
    expect(
      houseWalletRowSchema.safeParse({ ...row, verified: 'true' }).success
    ).toBe(false);
  });
});

describe('houseWalletRowsSchema', () => {
  it('accepts no rows and at most one row per role', () => {
    expect(houseWalletRowsSchema.safeParse([]).success).toBe(true);
    expect(houseWalletRowsSchema.safeParse([row, row, row, row]).success).toBe(
      false
    );
  });
});

describe('houseWalletIntegrationIdSchema', () => {
  it('accepts a uuid and refuses anything else', () => {
    expect(
      houseWalletIntegrationIdSchema.safeParse(
        'e5e00000-0000-4000-8000-000000000005'
      ).success
    ).toBe(true);
    expect(
      houseWalletIntegrationIdSchema.safeParse('integration-1').success
    ).toBe(false);
  });
});
