import { describe, expect, it, vi } from 'vitest';
import { WALLET_PAY_DELIVERERS } from './wallet-pay-deliverers';

vi.mock('server-only', () => ({}));
vi.mock('./wallet-pay-refund-uncollected', () => ({
  refundUncollectedPayment: 'refund-uncollected',
}));

describe('WALLET_PAY_DELIVERERS', () => {
  it('only registers known wallet pay products', () => {
    for (const purpose of Object.keys(WALLET_PAY_DELIVERERS))
      expect(['imei_check', 'vtu']).toContain(purpose);
  });
  it('refunds an uncollected IMEI payment (no plaintext IMEI is stored)', () => {
    expect(WALLET_PAY_DELIVERERS.imei_check).toBe('refund-uncollected');
  });
});
