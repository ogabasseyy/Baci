import { renderToReadableStream } from 'react-dom/server.edge';
import { afterEach, expect, it, vi } from 'vitest';
import GiftCardPage from './page';

const { getGiftCardPreviewQuote, createClient } = vi.hoisted(() => ({
  getGiftCardPreviewQuote: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: async () => ({ slug: 'ogabassey' }),
}));
vi.mock('@/lib/storefront-path-prefix', () => ({
  getStorefrontPathPrefix: () => '/ogabassey',
}));
vi.mock('@/lib/gift-cards/preview-quote', () => ({ getGiftCardPreviewQuote }));
vi.mock('@/lib/gift-cards/pilot-wallet-config', () => ({
  getGiftCardPilotConfig: () => ({ userId: 'fixture-user' }),
  PILOT_PRODUCT_ID: '2844',
}));
vi.mock('@/lib/supabase/server', () => ({ createClient }));
vi.mock('./pilot-wallet-form', () => ({
  PilotWalletForm: () => <p>Pilot checkout</p>,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it('preselects a result from search without quoting or exposing the pilot on an auth outage', async () => {
  vi.stubEnv('OGABASSEY_GIFT_CARD_PREVIEW', 'true');
  vi.stubEnv('OGABASSEY_GIFT_CARD_PREVIEW_USD_CENTS', '{"2844":1028}');
  createClient.mockRejectedValue(new Error('auth offline'));
  const stream = await renderToReadableStream(
    <GiftCardPage
      params={Promise.resolve({ slug: 'ogabassey' })}
      searchParams={Promise.resolve({ selection: '2844' })}
    />
  );
  await stream.allReady;
  const html = await new Response(stream).text();

  expect(html).toContain('Select Get current price');
  expect(html).toContain('value="2844" selected=""');
  expect(html).not.toContain('Pilot checkout');
  expect(getGiftCardPreviewQuote).not.toHaveBeenCalled();
});
