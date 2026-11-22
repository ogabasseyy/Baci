import { expect, it, vi } from 'vitest';
import { loadPaymentVerificationTransaction } from './load-payment-verification-transaction';

it.each([
  [{ data: null, error: null }, 404],
  [{ data: null, error: { code: '57014' } }, 503],
] as const)('returns the matching lookup failure (%j)', async (result, status) => {
  const eq = vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(result) }));
  const from = vi.fn(() => ({ select: vi.fn(() => ({ eq })) }));
  const lookup = await loadPaymentVerificationTransaction(
    'reference',
    vi.fn(() => ({ from })) as never
  );
  expect(lookup.ok).toBe(false);
  if (lookup.ok) throw new Error('Expected lookup failure');
  expect(lookup.response.status).toBe(status);
  expect(from).toHaveBeenCalledWith('transactions');
  expect(eq).toHaveBeenCalledWith('gateway_reference', 'reference');
});
