import { expect, it, vi } from 'vitest';
import { verifyPaymentReference } from './verify-payment-reference';

it('rejects an empty reference before starting transaction lookup', async () => {
  const load = vi.fn();
  const finalize = vi.fn();

  expect((await verifyPaymentReference('  ', { load, finalize })).status).toBe(
    400
  );
  expect(load).not.toHaveBeenCalled();
  expect(finalize).not.toHaveBeenCalled();
});

it('returns an unavailable lookup without attempting settlement', async () => {
  const unavailable = Response.json(
    { error: 'Verification unavailable' },
    { status: 503 }
  );
  const load = vi.fn().mockResolvedValue({ ok: false, response: unavailable });
  const finalize = vi.fn();

  expect(await verifyPaymentReference(' BAC-123 ', { load, finalize })).toBe(
    unavailable
  );
  expect(load).toHaveBeenCalledWith('BAC-123');
  expect(finalize).not.toHaveBeenCalled();
});
