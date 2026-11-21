import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  orderId,
  reference,
  request,
  secret,
  setup,
} from './bank-card-offer-flow.test-support';
import { mocks, userId } from './bank-card-offer-flow-mocks.test-support';
import { POST as verify } from './verify/route';

describe('bank card offer verification', () => {
  it.each([
    'cookie',
    'bearer',
  ] as const)('keeps a paid %s capture on review after a durable hold', async (authMode) => {
    const { capture } = setup('035', 'Wema Bank');
    const paid = await verify(request('verify', { reference }));
    expect(paid.status).toBe(200);
    await expect(paid.json()).resolves.toMatchObject({
      finalizationOutcome: 'completed',
    });

    mocks.rpc.mockClear();
    capture.held = true;
    mocks.cookieAuth.mockResolvedValueOnce({
      authMode,
      user: { id: userId },
      supabase: mocks,
    });
    const input = request('verify', { reference });
    if (authMode === 'bearer')
      input.headers.set('authorization', 'Bearer test-only');
    const replay = await verify(input);

    expect(replay.status).toBe(202);
    await expect(replay.json()).resolves.toMatchObject({
      code: 'BANK_CARD_OFFER_CAPTURE_REVIEW',
      orderId,
      status: 'pending',
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );
  });

  it.each([
    'cookie',
    'bearer',
  ] as const)('keeps a processing Paystack transaction pending for %s checkout', async (authMode) => {
    const { data } = setup('035', 'Wema Bank');
    mocks.cookieAuth.mockResolvedValueOnce({
      authMode,
      user: { id: userId },
      supabase: mocks,
    });
    mocks.verify.mockResolvedValueOnce({
      success: true,
      data: { ...data, status: 'processing' },
    });
    const input = request('verify', { reference });
    if (authMode === 'bearer')
      input.headers.set('authorization', 'Bearer test-only');
    const result = await verify(input);
    expect(result.status).toBe(202);
    await expect(result.json()).resolves.toMatchObject({
      success: false,
      status: 'pending',
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );
  });

  it('records the terminal review for a buyer using native verification', async () => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    const { data } = setup('035', 'Wema Bank');
    mocks.cookieAuth.mockResolvedValueOnce({
      authMode: 'bearer',
      user: { id: userId },
      supabase: mocks,
    });
    mocks.verify.mockResolvedValueOnce({
      success: true,
      data: { ...data, status: 'abandoned' },
    });

    const result = await verify(
      new NextRequest('http://localhost/api/payments/verify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-only',
        },
        body: JSON.stringify({ reference }),
      })
    );

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toMatchObject({
      status: 'abandoned',
      orderId,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'flag_bank_card_offer_terminal_review',
      expect.objectContaining({ p_status: 'abandoned' })
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([
    'cookie',
    'bearer',
  ] as const)('rejects %s verification from the wrong storefront before contacting Paystack', async (authMode) => {
    setup('035', 'Wema Bank');
    mocks.cookieAuth.mockResolvedValueOnce({
      authMode,
      user: { id: userId },
      supabase: mocks,
    });
    const wrongStoreRequest = request('verify', {
      reference,
      merchantSlug: 'another-store',
    });
    if (authMode === 'bearer')
      wrongStoreRequest.headers.set('authorization', 'Bearer test-only');
    const result = await verify(wrongStoreRequest);

    expect(result.status).toBe(403);
    await expect(result.json()).resolves.toMatchObject({
      code: 'BANK_CARD_OFFER_VERIFICATION_DENIED',
    });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalledWith('transactions');
  });

  it.each([
    { amount: 9501 },
    { currency: 'USD' },
  ])('keeps verification pending for a capture that differs from the saved payable (%j)', async (changes) => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    const { data } = setup('035', 'Wema Bank');
    mocks.verify.mockResolvedValue({
      success: true,
      data: { ...data, ...changes },
    });

    const response = await verify(request('verify', { reference }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      code: 'BANK_CARD_OFFER_CAPTURE_REVIEW',
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'approve_bank_card_offer_capture',
      expect.anything()
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );
  });

  it.each([
    { domain: 'live' },
    { reference: 'different-reference' },
  ])('quarantines mismatched terminal evidence %j', async (mismatch) => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    const { data } = setup('035', 'Wema Bank');
    mocks.verify.mockResolvedValue({
      success: true,
      data: { ...data, status: 'failed', ...mismatch },
    });

    const result = await verify(request('verify', { reference }));
    expect(result.status).toBe(202);
    await expect(result.json()).resolves.toMatchObject({
      code: 'BANK_CARD_OFFER_CAPTURE_REVIEW',
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'flag_bank_card_offer_terminal_review',
      expect.anything()
    );
  });

  it('recovers an approved capture after Paystack verification is available again', async () => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    const { data } = setup('035', 'Wema Bank', undefined, true, true);

    expect((await verify(request('verify', { reference }))).status).toBe(500);
    mocks.verify.mockResolvedValueOnce({
      success: false,
      code: 'NETWORK_ERROR',
    });
    const outage = await verify(request('verify', { reference }));
    expect(outage.status).toBe(503);
    expect(outage.headers.get('Retry-After')).toBe('15');
    expect(
      mocks.rpc.mock.calls.filter(
        ([name]) => name === 'complete_order_gateway_payment'
      )
    ).toHaveLength(1);

    mocks.verify.mockResolvedValueOnce({ success: true, data });
    const replay = await verify(request('verify', { reference }));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ success: true });
    expect(mocks.verify).toHaveBeenCalledTimes(3);
  });

  it('reviews a reversal after approval without retrying settlement', async () => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    const { data } = setup('035', 'Wema Bank', undefined, true, true);

    expect((await verify(request('verify', { reference }))).status).toBe(500);
    mocks.verify.mockResolvedValueOnce({
      success: true,
      data: { ...data, status: 'reversed', amount: 800 },
    });

    const replay = await verify(request('verify', { reference }));

    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      success: false,
      status: 'reversed',
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'flag_bank_card_offer_terminal_review',
      expect.objectContaining({
        p_status: 'reversed',
        p_reported_amount_kobo: 800,
      })
    );
    expect(
      mocks.rpc.mock.calls.filter(
        ([name]) => name === 'complete_order_gateway_payment'
      )
    ).toHaveLength(1);
  });
});
