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

it('only accepts a snapshot for the exact requested reference', async () => {
  const row = {
    transaction_id: 'payment',
    order_id: 'order',
    merchant_id: 'merchant',
    gateway_reference: 'saved-reference',
    amount: 95,
  };
  const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
  const client = { rpc } as never;
  await expect(
    readSessionlessPaymentReferenceSnapshot(client, 'other-reference')
  ).resolves.toBeNull();
  await expect(
    readSessionlessPaymentReferenceSnapshot(client, row.gateway_reference)
  ).resolves.toMatchObject({ orderId: 'order', merchantId: 'merchant' });
});
