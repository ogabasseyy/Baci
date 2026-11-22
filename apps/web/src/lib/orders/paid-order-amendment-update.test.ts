import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { sendEmail } from '@/lib/zeptomail';
import { drainPaidOrderAmendmentUpdates } from './paid-order-amendment-update';

vi.mock('@/env', () => ({
  env: { NEXT_PUBLIC_ROOT_DOMAIN: 'example.invalid' },
}));
vi.mock('@/lib/zeptomail', () => ({ sendEmail: vi.fn() }));

const id = '1afb87c4-43a3-4be3-97ad-76bc4926b111';
const claim = {
  claim: id,
  orderId: id,
  merchantId: id,
  customerId: null,
  email: 'shopper@example.invalid',
  merchantName: 'Synthetic Store',
  merchantSlug: 'synthetic',
  orderNumber: 'FIXTURE',
  trackingToken: 'opaque-proof',
  eventType: 'reversed',
  status: {
    state: 'reversed',
    holdFulfillment: false,
    balanceDueMinor: 0,
    refundOwedMinor: 0,
    documentId: id,
    documentNumber: 2,
  },
  documentId: id,
};

it('skips an obsolete update and sends the order link with the corrective state', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: ['1', '2'] })
    .mockResolvedValueOnce({ data: null })
    .mockResolvedValueOnce({ data: claim })
    .mockResolvedValueOnce({ data: true });
  vi.mocked(sendEmail).mockResolvedValue({ success: true });
  await drainPaidOrderAmendmentUpdates(
    { rpc } as unknown as SupabaseClient,
    Date.now() + 10_000
  );
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      textContent: expect.stringContaining('original items have been restored'),
      htmlContent: expect.stringContaining(
        'https://synthetic.example.invalid/track-order?token=opaque-proof'
      ),
      auditContext: expect.objectContaining({
        metadata: { trigger: 'paid_order_amendment_update', documentId: id },
      }),
    })
  );
  expect(rpc).toHaveBeenLastCalledWith('complete_paid_order_amendment_update', {
    p_claim: id,
    p_sent: true,
  });
});

it('takes a tokenless guest to tracking with the order preselected and keeps email out of the link', async () => {
  vi.mocked(sendEmail).mockClear().mockResolvedValue({ success: true });
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: ['3'] })
    .mockResolvedValueOnce({ data: { ...claim, trackingToken: null } })
    .mockResolvedValueOnce({ data: true });
  await drainPaidOrderAmendmentUpdates({ rpc }, Date.now() + 10_000);
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      textContent: expect.stringContaining(
        `https://synthetic.example.invalid/track-order?order_id=${id}`
      ),
    })
  );
  expect(vi.mocked(sendEmail).mock.calls[0][0].textContent).not.toContain(
    claim.email
  );
});
