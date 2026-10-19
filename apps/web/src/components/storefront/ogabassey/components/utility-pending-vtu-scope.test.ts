import { describe, expect, it } from 'vitest';
import { scopePendingVtuSignature } from './utility-pending-vtu-scope';

describe('scopePendingVtuSignature', () => {
  it('binds the scoped key to owner and merchant', () => {
    const scopedA = scopePendingVtuSignature(
      'customer-a',
      'merchant-1',
      '{"scoped":true}'
    );

    expect(
      scopePendingVtuSignature('customer-b', 'merchant-1', '{"scoped":true}')
    ).not.toBe(scopedA);
    expect(
      scopePendingVtuSignature('customer-a', 'merchant-2', '{"scoped":true}')
    ).not.toBe(scopedA);
    expect(
      scopePendingVtuSignature('customer-a', 'merchant-1', '{"scoped":true}')
    ).toBe(scopedA);
  });

  it('digests the scoped key so no identifier rests in the map', () => {
    const scoped = scopePendingVtuSignature(
      'customer-a',
      'merchant-1',
      '{"phoneNumber":"08030000000"}'
    );

    expect(scoped).toMatch(/^[0-9a-f]{64}$/);
    expect(scoped).not.toContain('08030000000');
    expect(scoped).not.toContain('customer-a');
  });
});
