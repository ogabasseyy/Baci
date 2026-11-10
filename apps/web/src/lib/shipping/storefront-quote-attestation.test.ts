import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./shipping-quote-route-proof', () => ({
  createShippingQuoteRouteProof: vi.fn((v) => ({
    version: 'baci-shipping-quote-proof:v1',
    action: v.action,
    subject_id: v.subjectId,
    merchant_id: v.merchantId,
    payload_text: JSON.stringify(v.payload),
    issued_at: new Date().toISOString(),
    proof_id: 'a'.repeat(24),
    signature: 'b'.repeat(64),
  })),
}));

import { createQuoteReadCapability } from './quote-session-capability';
import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';
import {
  assertStorefrontQuoteStorage,
  persistStorefrontShippingQuote,
  readStorefrontShippingQuotes,
  resolveStorefrontQuoteSession,
} from './storefront-quote-attestation';

it('sends the complete server-provided quote through the normal client RPC without another client', async () => {
  const rpc = vi.fn(async () => ({ data: 'quote-id', error: null }));
  const quote = {
    id: 'quote-id',
    merchant_id: 'resolved-merchant',
    session_id: 'synthetic',
    price: 1500,
  };
  await persistStorefrontShippingQuote({ rpc } as never, quote);
  expect(createShippingQuoteRouteProof).toHaveBeenCalledWith({
    action: 'persist_storefront_shipping_quote',
    subjectId: 'quote-id',
    merchantId: 'resolved-merchant',
    payload: { quote },
  });
  expect(rpc).toHaveBeenCalledWith('persist_storefront_shipping_quote', {
    p_quote: quote,
    p_route_proof: expect.objectContaining({ signature: 'b'.repeat(64) }),
  });
});
it('requires the POST-issued continuation for cached reads and never mints one from a caller session ID', async () => {
  const rpc = vi.fn(async () => ({ data: [], error: null }));
  const merchant = '11111111-1111-4111-8111-111111111111';
  expect(
    await readStorefrontShippingQuotes(
      { rpc } as never,
      merchant,
      'session',
      undefined
    )
  ).toMatchObject({ error: { code: 'QUOTE_SESSION_REQUIRED' } });
  expect(rpc).not.toHaveBeenCalled();
  const token = createQuoteReadCapability(merchant, 'session');
  await readStorefrontShippingQuotes(
    { rpc } as never,
    merchant,
    'session',
    token
  );
  expect(rpc).toHaveBeenCalledWith(
    'read_storefront_shipping_quotes',
    expect.objectContaining({
      p_merchant_id: merchant,
      p_session_id: 'session',
      p_route_proof: expect.objectContaining({
        payload_text: JSON.stringify({
          merchant_id: merchant,
          session_id: 'session',
        }),
      }),
    })
  );
  rpc.mockClear();
  await expect(
    persistStorefrontShippingQuote({ rpc } as never, {
      id: 'q',
      merchant_id: null,
    })
  ).rejects.toThrow('QUOTE_MERCHANT_REQUIRED');
  expect(rpc).not.toHaveBeenCalled();
});
it('fails readiness before provider I/O when server signing or Vault verification is unavailable', async () => {
  const rpc = vi.fn(async () => ({ data: false, error: null }));
  await expect(
    assertStorefrontQuoteStorage({ rpc } as never, 'm')
  ).rejects.toThrow('QUOTE_STORAGE_UNAVAILABLE');
  rpc.mockClear();
  vi.mocked(createShippingQuoteRouteProof).mockImplementationOnce(() => {
    throw Error('missing secret');
  });
  await expect(
    assertStorefrontQuoteStorage({ rpc } as never, 'm')
  ).rejects.toThrow('QUOTE_STORAGE_UNAVAILABLE');
  expect(rpc).not.toHaveBeenCalled();
});

it('never mints read authority for a caller-selected existing session without its continuation', async () => {
  const rpc = vi.fn(async () => ({ data: [], error: null }));
  const merchant = '11111111-1111-4111-8111-111111111111';
  const fresh = await resolveStorefrontQuoteSession(
    { rpc } as never,
    merchant,
    'another-guest-session',
    undefined
  );
  expect(fresh).not.toBe('another-guest-session');
  expect(rpc).not.toHaveBeenCalled();
  const token = createQuoteReadCapability(merchant, 'owned');
  expect(
    await resolveStorefrontQuoteSession(
      { rpc } as never,
      merchant,
      'owned',
      token
    )
  ).toBe('owned');
  rpc.mockResolvedValueOnce({ data: [], error: { code: '42501' } } as never);
  expect(
    await resolveStorefrontQuoteSession(
      { rpc } as never,
      merchant,
      'other',
      token
    )
  ).not.toBe('other');
});
