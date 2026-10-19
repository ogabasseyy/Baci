import {
  resolveIdempotencyScopeOwnerId,
  resolveWalletReadOwnerId,
} from './utility-owner-ids';

describe('utility-owner-ids', () => {
  it('resolves wallet reads customer-first to match the wallet row', () => {
    expect(resolveWalletReadOwnerId('cust-1', 'user-1')).toBe('cust-1');
    expect(resolveWalletReadOwnerId('cust-1', undefined)).toBe('cust-1');
  });

  it('falls back to the auth user for wallet reads before hydration', () => {
    expect(resolveWalletReadOwnerId(undefined, 'user-1')).toBe('user-1');
    expect(resolveWalletReadOwnerId(null, null)).toBeNull();
    expect(resolveWalletReadOwnerId(undefined, undefined)).toBeNull();
  });

  it('resolves idempotency scope user-first for hydration stability', () => {
    expect(resolveIdempotencyScopeOwnerId('user-1', 'cust-1')).toBe('user-1');
    expect(resolveIdempotencyScopeOwnerId('user-1', undefined)).toBe('user-1');
  });

  it('falls back to the customer row for scope when no auth user exists', () => {
    expect(resolveIdempotencyScopeOwnerId(undefined, 'cust-1')).toBe('cust-1');
    expect(
      resolveIdempotencyScopeOwnerId(undefined, undefined)
    ).toBeUndefined();
  });
});
