import { expect, it, vi } from 'vitest';
import { verifyGatewayPayment } from './verify-gateway-payment';
import { verifyPaymentReference } from './verify-payment-reference';

vi.mock('./verify-gateway-payment', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, verifyGatewayPayment: vi.fn() };
});

it('rejects an empty reference before starting transaction lookup', async () => {
  const load = vi.fn();
  const finalize = vi.fn();

  expect((await verifyPaymentReference('  ', { load, finalize })).status).toBe(
    400
  );
  expect(load).not.toHaveBeenCalled();
  expect(finalize).not.toHaveBeenCalled();
});

it.each([
  { outcome: 'ready', status: 200 },
  { outcome: 'awaiting_evidence', status: 503 },
])('checks certified surcharge evidence before finalizing ($outcome)', async ({
  outcome,
  status,
}) => {
  const reference = 'BAC-123';
  const gatewayResponse = {
    id: 12345,
    reference,
    domain: 'test',
    amount: 517_767,
    requested_amount: 500_000,
    fees: 17_767,
    currency: 'NGN',
    status: 'success',
  };
  vi.mocked(verifyGatewayPayment).mockResolvedValueOnce({
    gatewayResponse,
    status: 'success',
    success: true,
  });
  const rpc = vi.fn().mockResolvedValue({
    data: {
      outcome,
      ...(outcome === 'ready' ? { customerFeeMinor: 17_767 } : {}),
    },
    error: null,
  });
  const supabase = {
    rpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: { payment_status: 'unpaid' } }),
        })),
      })),
    })),
  };
  const load = vi.fn().mockResolvedValue({
    ok: true,
    supabase,
    transaction: {
      amount: 5000,
      currency: 'NGN',
      gateway: 'paystack',
      gateway_reference: reference,
      metadata: null,
      order_id: 'synthetic-order',
      status: 'pending',
    },
  });
  const finalize = vi.fn().mockResolvedValue(Response.json({ success: true }));
  const response = await verifyPaymentReference(reference, { load, finalize });

  expect(response.status).toBe(status);
  expect(rpc).toHaveBeenCalledWith(
    'resolve_paid_order_checkout_capture',
    expect.objectContaining({
      p_reference: reference,
    })
  );
  if (outcome === 'ready') {
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayResponse: expect.objectContaining({
          baci_paystack_checkout_customer_fee_minor: 17_767,
        }),
      })
    );
  } else {
    expect(finalize).not.toHaveBeenCalled();
  }
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
