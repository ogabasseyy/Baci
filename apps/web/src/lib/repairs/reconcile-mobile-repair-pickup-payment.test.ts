import { expect, it, vi } from 'vitest';
import { reconcileMobileRepairPickupPayment } from './reconcile-mobile-repair-pickup-payment';

const verify = vi.hoisted(() => vi.fn());
vi.mock('@/lib/paystack', () => ({ verifyTransaction: verify }));
const unknown = {
  success: false as const,
  code: 'payment_initialization_unknown',
  error: 'unknown',
  reference: 'RPU-123',
};
it('keeps the original reference when verification fails', async () => {
  verify.mockResolvedValue({ success: false });
  expect(await reconcileMobileRepairPickupPayment(unknown, 'merchant')).toEqual(
    unknown
  );
  expect(verify).toHaveBeenCalledWith('RPU-123');
});
it('does not trust an unrelated payment without signed metadata', async () => {
  verify.mockResolvedValue({
    success: true,
    data: { reference: 'RPU-123', status: 'success', metadata: null },
  });
  expect(await reconcileMobileRepairPickupPayment(unknown, 'merchant')).toEqual(
    unknown
  );
});
