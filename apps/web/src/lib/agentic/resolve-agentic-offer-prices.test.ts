import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAgenticOfferPrices } from './resolve-agentic-offer-prices';

const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const OFFER_ID = '33333333-3333-4333-8333-333333333333';

function supabaseWithOffers(
  offers: Record<string, unknown>[] | null,
  error: unknown = null
) {
  return {
    rpc: vi.fn(async () => ({ data: offers, error })),
  } as unknown as Parameters<typeof resolveAgenticOfferPrices>[0];
}

function offerLine() {
  return [
    {
      product_id: PRODUCT_ID,
      offer_id: OFFER_ID,
      condition: 'used',
      has_assurance: false,
      assurance_fee: 0,
      quantity: 1,
    },
  ];
}

describe('resolveAgenticOfferPrices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the verified live prices on success', async () => {
    const supabase = supabaseWithOffers([
      {
        offer_id: OFFER_ID,
        price: 400_000,
        condition: 'used',
        is_active: true,
      },
    ]);

    const result = await resolveAgenticOfferPrices(supabase, offerLine(), null);

    expect(result.ok).toBe(true);
    expect(
      result.ok
        ? result.liveOfferPrices.get(`${PRODUCT_ID}::${OFFER_ID}`)
        : undefined
    ).toBe(400_000);
  });

  it('fails fast for unbound orders when verification fails', async () => {
    const supabase = supabaseWithOffers([]);

    const result = await resolveAgenticOfferPrices(supabase, offerLine(), null);

    expect(result.ok).toBe(false);
    expect(!result.ok ? result.result.status : undefined).toBe(400);
  });

  it('falls through with no live prices for bound orders on verification failure', async () => {
    const supabase = supabaseWithOffers([]);

    const result = await resolveAgenticOfferPrices(supabase, offerLine(), {
      cart_id: 'cart-1',
    });

    expect(result).toEqual({ ok: true, liveOfferPrices: new Map() });
  });
});
