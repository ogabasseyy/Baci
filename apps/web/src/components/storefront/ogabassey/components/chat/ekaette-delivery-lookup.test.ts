import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveChatwootCarrierQuote } from '@/hooks/chatwoot-confirmed-carrier-quote';
import { createEkaetteDeliveryLookup } from './ekaette-delivery-lookup';
import { postChatwootBridgeJson } from './chatwoot-bridge-request';

vi.mock('./chatwoot-bridge-request', () => ({ postChatwootBridgeJson: vi.fn() }));

const cart = {
  key: 'cart:1',
  merchantId: '00000000-0000-4000-8000-000000000001',
  subtotal: 385000,
  items: [{ name: 'iPhone 13', quantity: 1, weight: 1, value: 385000 }],
};

const match = { placeId: 'google-place', fullText: '15 Example Street, Ikeja, Lagos, Nigeria' };
const signedMatch = () => ({
  placeId: match.placeId,
  label: match.fullText,
  googleSession: crypto.randomUUID(),
  expiresAt: Date.now() + 60000,
  proof: 'a'.repeat(64),
});
const details = {
  formattedAddress: match.fullText,
  streetNumber: '15',
  route: 'Example Street',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  location: { latitude: 6.605, longitude: 3.34 },
};

const command = (payload: Record<string, unknown>) =>
  `baci-ekaette-delivery:${JSON.stringify({ requestId: crypto.randomUUID(), conversationId: 41, ...payload })}`;
const confirm = (matchId: string, answer = 'That’s the right place.') =>
  command({ action: 'decide', matchId, answer, sessionToken: 'test-session' });

async function search(
  lookup: ReturnType<typeof createEkaetteDeliveryLookup>,
  post: ReturnType<typeof vi.fn<(result: Record<string, unknown>) => void>>
) {
  vi.mocked(postChatwootBridgeJson).mockResolvedValueOnce({ match: signedMatch() });
  await lookup.receive(command({ action: 'search', address: match.fullText, sessionToken: 'test-session' }), post);
  const reply = post.mock.lastCall?.[0] as
    | { status?: string; matches?: Array<{ id: string; label: string }> }
    | undefined;
  expect(reply).toMatchObject({ status: 'matches', matches: [{ label: match.fullText }] });
  expect(reply?.matches?.[0]).not.toHaveProperty('placeId');
  return reply?.matches?.[0]?.id as string;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('Ekaette address confirmation', () => {
  it('waits for confirmation, then quotes only GIG using Google’s address and the active cart', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ details }))
      .mockResolvedValueOnce(Response.json({ expiresAt: new Date(Date.now() + 60000).toISOString(), quotes: { all: [
        { id: 'topship', provider: 'TOPSHIP', displayName: 'Other', serviceTier: 'standard', carrierName: 'Other', estimatedDays: 3, price: 1000, currency: 'NGN', pickupIncluded: false, insuranceIncluded: false },
        { id: '00000000-0000-4000-8000-000000000009', provider: 'GIGL', displayName: 'GIG Standard', serviceTier: 'standard', carrierName: 'GIG', estimatedDays: 2, price: 2700, currency: 'NGN', pickupIncluded: false, insuranceIncluded: false },
      ] }}));
    vi.stubGlobal('fetch', fetcher);
    const lookup = createEkaetteDeliveryLookup(() => cart);
    const post = vi.fn();
    const matchId = await search(lookup, post);
    expect(fetcher).not.toHaveBeenCalled();
    vi.mocked(postChatwootBridgeJson).mockResolvedValue({ decision: 'confirmed' });
    await lookup.receive(confirm(matchId), post);
    expect(postChatwootBridgeJson).toHaveBeenCalledWith(
      '/api/storefront/chatwoot/delivery-confirmation',
      expect.objectContaining({ action: 'decide', answer: 'That’s the right place.', conversationId: 41, sessionToken: 'test-session', match: expect.objectContaining({ label: match.fullText, proof: 'a'.repeat(64) }) }),
      '',
      expect.any(AbortSignal),
    );
    const [url, options] = fetcher.mock.calls[1];
    expect(url).toBe('/api/shipping/quotes');
    expect(JSON.parse(options.body)).toMatchObject({
      carrier: 'GIGL',
      receiver: { city: 'Ikeja', address: '15 Example Street', latitude: 6.605, longitude: 3.34 },
      items: cart.items,
    });
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'quoted', price: 2700 }));
    const id = post.mock.lastCall?.[0].quoteId;
    const scope = { id, cartKey: cart.key, merchantId: cart.merchantId, conversationId: 41 };
    expect(resolveChatwootCarrierQuote(scope)).toMatchObject({
      quote: { provider: 'GIGL', price: 2700 },
      address: { address: '15 Example Street', state: 'Lagos' },
    });
    expect(resolveChatwootCarrierQuote({ ...scope, cartKey: 'cart:2' })).toBeNull();
    expect(resolveChatwootCarrierQuote({ ...scope, conversationId: 42 })).toBeNull();

  });

  it('refuses a confirmation outside the current Google results', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const post = vi.fn();
    await createEkaetteDeliveryLookup(() => cart).receive(
      confirm(crypto.randomUUID()),
      post
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ status: 'address_unavailable' }));
  });

  it.each([
    ['unclear', 'confirmation_unclear'],
    ['different_address', 'different_address'],
  ])('does not ask GIG when the reply is %s', async (decision, status) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(postChatwootBridgeJson).mockResolvedValue({ decision });
    const lookup = createEkaetteDeliveryLookup(() => cart);
    const post = vi.fn();
    const matchId = await search(lookup, post);
    await lookup.receive(confirm(matchId, 'Can I use a different place?'), post);
    expect(fetcher).not.toHaveBeenCalled();
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ status }));
  });

  it('reports GIG unavailable without substituting another carrier', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ details }))
      .mockResolvedValueOnce(Response.json({ quotes: { all: [] } }));
    vi.stubGlobal('fetch', fetcher);
    const lookup = createEkaetteDeliveryLookup(() => cart);
    const post = vi.fn();
    const matchId = await search(lookup, post);
    vi.mocked(postChatwootBridgeJson).mockResolvedValue({ decision: 'confirmed' });
    await lookup.receive(confirm(matchId), post);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'quote_unavailable' }));
  });
});
