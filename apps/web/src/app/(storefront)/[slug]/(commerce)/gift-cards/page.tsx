import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import {
  getGiftCardPilotConfig,
  PILOT_PRODUCT_ID,
} from '@/lib/gift-cards/pilot-wallet-config';
import {
  getGiftCardPreviewCatalog,
  isGiftCardPreviewEnabled,
} from '@/lib/gift-cards/preview-catalog';
import { getGiftCardPreviewQuote } from '@/lib/gift-cards/preview-quote';
import { getGiftCardQuote } from '@/lib/gift-cards/quote';
import { asRoute } from '@/lib/routes';
import { getStorefrontPathPrefix } from '@/lib/storefront-path-prefix';
import { createClient } from '@/lib/supabase/server';
import { MockGiftCardConfirmation } from './mock-gift-card-confirmation';
import { PilotWalletForm } from './pilot-wallet-form';

export const metadata: Metadata = {
  title: 'Gift Cards',
  robots: { index: false, follow: true },
};

interface GiftCardPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    card?: string | string[];
    selection?: string | string[];
  }>;
}

export default function GiftCardPage(props: GiftCardPageProps) {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <h1 className="text-3xl font-bold">Gift Cards</h1>
      <Suspense fallback={<p role="status">Loading gift cards…</p>}>
        <GiftCardPreview {...props} />
      </Suspense>
    </main>
  );
}

async function GiftCardPreview({ params, searchParams }: GiftCardPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const merchant = await getRequestScopedMerchant(slug);
  if (!merchant || !isGiftCardPreviewEnabled(merchant.slug)) notFound();

  // Search selects a catalog item via selection. Only submitting the price
  // form (card) explicitly requests a preview. Wallet confirmation requotes.
  const card = Array.isArray(query.card) ? query.card[0] : query.card;
  const selection = Array.isArray(query.selection)
    ? query.selection[0]
    : query.selection;
  const catalog = getGiftCardPreviewCatalog();
  const selected = catalog.find((item) => item.id === (card ?? selection));
  const key = process.env.JUICYWAY_EXCHANGE_RATE_READ_KEY?.trim();
  const configuredMarkup = process.env.OGABASSEY_GIFT_CARD_PREVIEW_MARKUP_BPS;
  const markup = Number(configuredMarkup);
  const markupIsValid =
    !!configuredMarkup && Number.isSafeInteger(markup) && markup >= 0;
  const requestHeaders = await headers();
  const prefix = getStorefrontPathPrefix(requestHeaders, merchant);
  const mockCheckout =
    process.env.NODE_ENV === 'development' &&
    process.env.OGABASSEY_GIFT_CARD_MOCK_CHECKOUT === 'true' &&
    /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(
      requestHeaders.get('host') ?? ''
    );
  const quote = mockCheckout
    ? (supplierUsdCents: number) =>
        getGiftCardQuote(supplierUsdCents, markup, 'mock-rate-key', async () =>
          Response.json({
            data: {
              symbol: 'USD-NGN',
              type: 'sell',
              locked: false,
              rate: 147999,
            },
          })
        )
    : (supplierUsdCents: number) =>
        getGiftCardPreviewQuote(supplierUsdCents, markup);
  const total =
    card !== undefined && selected && (mockCheckout || key) && markupIsValid
      ? await quote(selected.usdCents).catch(() => null)
      : null;
  const testQuote =
    mockCheckout && total !== null && selected
      ? {
          id: crypto.randomUUID(),
          cardId: selected.id,
          totalKobo: total,
          expiresAt: Date.now() + 60_000,
        }
      : null;
  const pilot =
    !mockCheckout && selected?.id === PILOT_PRODUCT_ID
      ? getGiftCardPilotConfig()
      : null;
  const pilotBuyer = pilot
    ? (await (await createClient()).auth.getUser()).data.user?.id ===
      pilot.userId
    : false;

  return (
    <>
      <p>Preview US gift cards and check the current naira price.</p>
      {catalog.length > 0 ? (
        <form
          action={asRoute(`${prefix}/gift-cards`)}
          method="get"
          className="space-y-3"
        >
          <label className="block font-medium" htmlFor="gift-card">
            Gift card and denomination
          </label>
          <select
            key={selected?.id ?? 'unselected'}
            id="gift-card"
            name="card"
            defaultValue={selected?.id ?? ''}
            required
            className="block w-full rounded-md border bg-store-background p-3 text-store-background-text"
          >
            <option value="" disabled>
              Select a gift card
            </option>
            {catalog.map((item) => (
              <option key={item.id} value={item.id}>
                {item.brand} · United States · {`$${item.denomination}`}
              </option>
            ))}
          </select>
          {selection !== undefined && card === undefined && selected && (
            <p className="text-sm">
              Select Get current price to see the naira price.
            </p>
          )}
          <button
            type="submit"
            className="min-h-11 rounded-md bg-store-primary px-4 py-2 text-white"
          >
            Get current price
          </button>
        </form>
      ) : (
        <p role="status">Gift cards are temporarily unavailable.</p>
      )}
      {pilotBuyer && <PilotWalletForm />}
      {card !== undefined && (
        <div role="status" className="rounded-md border p-4">
          {total === null || !selected ? (
            <p>
              We couldn’t quote that card. Choose an available card and try
              again.
            </p>
          ) : (
            <>
              <p className="text-lg font-semibold">
                {selected.brand} · {`$${selected.denomination}`} ·{' '}
                {new Intl.NumberFormat('en-NG', {
                  style: 'currency',
                  currency: 'NGN',
                }).format(total / 100)}
              </p>
              <p className="mt-1 text-sm">
                {testQuote
                  ? 'Test mode. This price uses a simulated exchange quote and expires in 60 seconds.'
                  : 'Price preview only. No payment is due.'}
              </p>
              {testQuote && (
                <MockGiftCardConfirmation
                  key={testQuote.id}
                  quote={testQuote}
                />
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
