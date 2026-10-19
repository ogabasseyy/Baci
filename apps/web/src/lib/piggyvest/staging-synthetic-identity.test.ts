import { describe, expect, it } from 'vitest';
import { resolvePiggyvestStagingSyntheticIdentity } from './staging-synthetic-identity';

describe('resolvePiggyvestStagingSyntheticIdentity', () => {
  it('resolves the same fixture for repeated calls', () => {
    expect(
      resolvePiggyvestStagingSyntheticIdentity(
        '20000000-0000-4000-8000-000000000001'
      )
    ).toEqual(
      resolvePiggyvestStagingSyntheticIdentity(
        '20000000-0000-4000-8000-000000000001'
      )
    );
  });

  it('allocates distinct fixtures per customer', () => {
    const first = resolvePiggyvestStagingSyntheticIdentity(
      '20000000-0000-4000-8000-000000000001'
    );
    const second = resolvePiggyvestStagingSyntheticIdentity(
      '20000000-0000-4000-8000-000000000002'
    );
    expect(second.bvn).not.toBe(first.bvn);
    expect(second.email).not.toBe(first.email);
    expect(second.phone).not.toBe(first.phone);
  });

  it('stays inside obviously-synthetic ranges', () => {
    const identity = resolvePiggyvestStagingSyntheticIdentity(
      '20000000-0000-4000-8000-000000000001'
    );
    expect(identity.bvn).toMatch(/^000\d{8}$/);
    expect(identity.name).toBe('Synthetic Customer');
    expect(identity.email).toMatch(/^synthetic\+[0-9a-f]{12}@example\.test$/);
    expect(identity.phone).toMatch(/^\+234000\d{7}$/);
  });

  it('never embeds the customer id or PII', () => {
    const customerId = '20000000-0000-4000-8000-000000000001';
    const identity = resolvePiggyvestStagingSyntheticIdentity(customerId);
    for (const value of Object.values(identity)) {
      expect(value).not.toContain(customerId);
      expect(value).not.toContain('adaeze');
    }
  });
});
