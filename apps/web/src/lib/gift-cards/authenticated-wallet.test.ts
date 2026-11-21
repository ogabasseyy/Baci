import { createHmac } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  confirmAuthenticatedGiftCardQuote,
  issueAuthenticatedGiftCardQuote,
} from './authenticated-wallet';

const supabase = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  rpc: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => supabase }));

const merchantId = '20000000-0000-4000-8000-000000000001';
vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: () => ({ id: merchantId, slug: 'ogabassey' }),
}));
const userId = '10000000-0000-4000-8000-000000000001';
const hmacKey = 'a'.repeat(48);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('prices with a fresh quote before confirmation and submits only its exact signed amount', async () => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  vi.stubEnv('GIFT_CARD_WALLET_QUOTE_HMAC', hmacKey);
  vi.stubEnv('JUICYWAY_EXCHANGE_RATE_READ_KEY', 'fixture-rate-key');
  vi.stubEnv('OGABASSEY_GIFT_CARD_PREVIEW_MARKUP_BPS', '1000');
  vi.stubEnv('OGABASSEY_GIFT_CARD_PREVIEW_USD_CENTS', '{"3007":500}');
  const fetchMock = vi.fn().mockImplementation((url, options) => {
    expect(url).toContain('source_currency=NGN&target_currency=USD&lock=false');
    expect(options).toMatchObject({ cache: 'no-store', method: 'GET' });
    return Response.json({
      data: { rate: 147999, symbol: 'USD-NGN', type: 'sell', locked: false },
    });
  });
  vi.stubGlobal('fetch', fetchMock);

  const first = await issueAuthenticatedGiftCardQuote({
    merchantId,
    cardId: '3007',
  });
  const { totalKobo, proof } = await issueAuthenticatedGiftCardQuote({
    merchantId,
    cardId: '3007',
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(proof.payload).not.toBe(first.proof.payload);
  expect(totalKobo).toBe(813995);
  expect(JSON.parse(proof.payload)).toMatchObject({
    merchantId,
    userId,
    totalKobo,
    cardId: '3007',
  });
  expect(proof.signature).toBe(
    createHmac('sha256', hmacKey)
      .update(`baci:gift-card-wallet:v1\n${proof.payload}`)
      .digest('hex')
  );
  expect(supabase.rpc).not.toHaveBeenCalled();

  const order_id = JSON.parse(proof.payload).id;
  supabase.rpc.mockResolvedValue({
    data: [{ order_id, order_status: 'paid' }],
  });
  await expect(confirmAuthenticatedGiftCardQuote(proof)).resolves.toEqual({
    order_id,
    order_status: 'paid',
  });
  expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith(
    'confirm_gift_card_wallet_quote',
    {
      p_payload: proof.payload,
      p_signature: proof.signature,
    }
  );
});

it('refuses confirmation without an authenticated user', async () => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: null } });
  await expect(confirmAuthenticatedGiftCardQuote(null)).rejects.toThrow(
    'Sign in'
  );
  expect(supabase.rpc).not.toHaveBeenCalled();
});

it.each([
  ['22023', 'expired_gift_card_quote', 'The price expired. Get a fresh quote.'],
  [
    'P0001',
    'insufficient_wallet_balance',
    'Your wallet balance is too low for this gift card.',
  ],
  ['XX000', 'internal diagnostic', 'Gift card payment could not be confirmed'],
])('maps wallet RPC code %s to a safe message', async (code, message, expected) => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  supabase.rpc.mockResolvedValue({ error: { code, message } });
  await expect(
    confirmAuthenticatedGiftCardQuote({
      payload: '{}',
      signature: 'a'.repeat(64),
    })
  ).rejects.toThrow(expected);
});
