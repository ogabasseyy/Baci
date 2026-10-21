import { describe, expect, it } from 'vitest';
import { isUnverifiedManualPaystackRefund } from './is-unverified-manual-paystack-refund';

describe('isUnverifiedManualPaystackRefund', () => {
  it('flags a manual Paystack row without provider proof', () => {
    expect(
      isUnverifiedManualPaystackRefund({
        gateway: 'manual',
        metadata: { method: 'paystack' },
      })
    ).toBe(true);
  });
  it('passes a provider-confirmed manual Paystack row', () => {
    expect(
      isUnverifiedManualPaystackRefund({
        gateway: 'manual',
        metadata: { method: 'paystack', provider_refund_status: 'processed' },
      })
    ).toBe(false);
  });
  it('passes non-Paystack manual rows', () => {
    expect(
      isUnverifiedManualPaystackRefund({
        gateway: 'manual',
        metadata: { method: 'bank_transfer' },
      })
    ).toBe(false);
  });
  it('passes provider rows regardless of metadata', () => {
    expect(
      isUnverifiedManualPaystackRefund({
        gateway: 'paystack',
        metadata: { method: 'paystack' },
      })
    ).toBe(false);
  });
  it('normalizes legacy gateway casing like the claim gate', () => {
    expect(
      isUnverifiedManualPaystackRefund({
        gateway: ' Manual ',
        metadata: { method: 'paystack' },
      })
    ).toBe(true);
  });
});
