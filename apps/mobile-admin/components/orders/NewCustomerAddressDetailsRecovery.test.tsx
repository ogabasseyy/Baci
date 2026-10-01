import { describe, expect, it, vi } from 'vitest';
import { NewCustomerAddressDetailsRecovery } from './NewCustomerAddressDetailsRecovery';

vi.mock('./NewCustomerManualAddressFallback', () => ({
  NewCustomerManualAddressFallback: () => null,
}));

describe('NewCustomerAddressDetailsRecovery', () => {
  it('exports a recovery surface for incomplete Google place details', () => {
    expect(typeof NewCustomerAddressDetailsRecovery).toBe('function');
  });
});
