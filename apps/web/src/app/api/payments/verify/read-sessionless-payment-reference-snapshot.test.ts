import { expect, it, vi } from 'vitest';
import { readSessionlessPaymentReferenceSnapshot } from './read-sessionless-payment-reference-snapshot';

it('preserves database errors and distinguishes them from an absent row', async () => {
  const denied = { code: '42501', message: 'permission denied' };
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: null, error: denied })
    .mockResolvedValueOnce({ data: [], error: null });
  await expect(
    readSessionlessPaymentReferenceSnapshot({ rpc } as never, 'fixture')
  ).rejects.toEqual(denied);
  await expect(
    readSessionlessPaymentReferenceSnapshot({ rpc } as never, 'fixture')
  ).resolves.toBeNull();
  expect(rpc).toHaveBeenCalledWith(
    'get_sessionless_payment_reference_snapshot',
    {
      p_gateway_reference: 'fixture',
    }
  );
});
