import { describe, expect, it, vi } from 'vitest';
import { digestBrilStashPayload } from './catalogue-snapshot';
import { createBrilStashPageCorrelation } from './page-correlation';
import { verifyBrilStashFeed } from './verify-feed';

const payload = [
  {
    external_id: 'fixture-one',
    product_url: 'https://shop.example.invalid/products/phone',
    title: 'Phone',
    description: 'Condition New. Box contents Phone.',
    category: 'Phones',
    price_naira: 365000,
    stock_quantity: 0,
    images: [{ url: 'https://media.example.invalid/phone.jpg' }],
  },
];
const state = {
  installationId: 'a0000000-0000-4000-8000-000000000001',
  generationId: 'b0000000-0000-4000-8000-000000000001',
  credentialId: 'c0000000-0000-4000-8000-000000000001',
  catalogueRevision: '9',
  servingRevision: '3',
  credentialRevision: '2',
  payloadDigest: digestBrilStashPayload(payload),
  totalCount: 1,
};
const requestId = 'd0000000-0000-4000-8000-000000000001';
const target = new URL(
  'https://feed.example.invalid/partners/yield/brilpay/products?page=1&limit=100&min_price=0'
);
const bearer = 'S'.repeat(43);

function fixture(
  options: {
    price?: number;
    credentialId?: string;
    servingRevision?: string;
    credentialRevision?: string;
    total?: string;
  } = {}
) {
  const readState = vi
    .fn()
    .mockResolvedValueOnce(state)
    .mockResolvedValueOnce({
      ...state,
      servingRevision: options.servingRevision ?? state.servingRevision,
      credentialRevision:
        options.credentialRevision ?? state.credentialRevision,
    });
  const fetchFeed = vi.fn(async () =>
    Response.json(
      [{ ...payload[0], price_naira: options.price ?? payload[0].price_naira }],
      {
        headers: {
          'X-Request-Id': requestId,
          'X-Baci-Catalogue-Correlation': createBrilStashPageCorrelation(
            requestId,
            {
              ...state,
              credentialId: options.credentialId ?? state.credentialId,
            }
          ),
          'X-Total-Count': options.total ?? '1',
          'X-Total-Pages': '1',
        },
      }
    )
  );
  return { readState, fetchFeed };
}

describe('full BrilStash feed verification', () => {
  it('returns a receipt for the exact full response and rejects redirects at fetch', async () => {
    const dependencies = fixture();
    await expect(
      verifyBrilStashFeed(target, bearer, dependencies)
    ).resolves.toEqual({ ...state, requestId, feedUrl: target.href });
    expect(dependencies.fetchFeed).toHaveBeenCalledWith(
      target,
      expect.objectContaining({
        redirect: 'error',
        headers: { Authorization: `Bearer ${bearer}` },
      })
    );
  });

  it('accepts probe state with equivalent values in a different key order', async () => {
    const dependencies = fixture();
    dependencies.readState
      .mockReset()
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(
        Object.fromEntries(Object.entries(state).reverse())
      );
    await expect(
      verifyBrilStashFeed(target, bearer, dependencies)
    ).resolves.toMatchObject({ requestId });
  });

  it('preserves a valid receipt without cancelling a drained response', async () => {
    const cancel = vi
      .spyOn(ReadableStreamDefaultReader.prototype, 'cancel')
      .mockRejectedValue(new Error('transport cleanup failed'));
    try {
      await expect(
        verifyBrilStashFeed(target, bearer, fixture())
      ).resolves.toMatchObject({ requestId });
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      cancel.mockRestore();
    }
  });

  it.each([
    { price: 350000 },
    { total: '2' },
    { credentialId: 'c0000000-0000-4000-8000-000000000002' },
    { servingRevision: '4' },
    { credentialRevision: '3' },
  ])('rejects a mismatched or stale full feed after a change to %j', async (change) => {
    await expect(
      verifyBrilStashFeed(target, bearer, fixture(change))
    ).rejects.toThrow('BrilStash feed verification failed');
  });
});
