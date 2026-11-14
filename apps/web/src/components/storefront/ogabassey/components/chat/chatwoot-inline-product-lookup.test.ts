import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ postChatwootBridgeJson: vi.fn() }));

vi.mock('./chatwoot-bridge-request', () => ({
  postChatwootBridgeJson: mocks.postChatwootBridgeJson,
}));

import { handleChatwootInlineProductLookup } from './chatwoot-inline-product-lookup';

const product = {
  availability: 'in_stock',
  condition: 'new',
  currency: 'NGN',
  image: 'https://cdn.example.test/phone.jpg',
  name: 'Phone 15',
  price: 300_000,
  slug: 'phone-15',
  variants: [],
};

function run(
  response: unknown,
  overrides: Partial<Parameters<typeof handleChatwootInlineProductLookup>[0]> = {}
) {
  const post = vi.fn();
  return {
    post,
    promise: handleChatwootInlineProductLookup({
      conversationId: 905,
      isCurrentAction: () => true,
      post,
      requestId: 'product-request-01',
      sessionToken: 'signed-token',
      slug: 'phone-15',
      storeSlug: 'shop',
      ...overrides,
    }),
  };
}

afterEach(() => vi.clearAllMocks());

describe('handleChatwootInlineProductLookup', () => {
  it('posts an available canonical product result', async () => {
    mocks.postChatwootBridgeJson.mockResolvedValueOnce({
      ok: true,
      requestId: 'product-request-01',
      product,
    });
    const { post, promise } = run(null);

    await promise;

    expect(mocks.postChatwootBridgeJson).toHaveBeenCalledWith(
      '/api/storefront/chatwoot/products',
      {
        conversationId: 905,
        requestId: 'product-request-01',
        sessionToken: 'signed-token',
        slug: 'phone-15',
      },
      'shop',
      undefined,
      { allowNonOkResponse: true }
    );
    expect(post).toHaveBeenCalledWith('baci-product-response:', {
      requestId: 'product-request-01',
      status: 'available',
      product,
    });
  });

  it('surfaces unsupported condition offers without guessing a card', async () => {
    mocks.postChatwootBridgeJson.mockResolvedValueOnce({
      ok: false,
      code: 'unsupported_condition_offers',
      requestId: 'product-request-01',
    });
    const { post, promise } = run(null);

    await promise;

    expect(post).toHaveBeenCalledWith('baci-product-response:', {
      requestId: 'product-request-01',
      status: 'unavailable',
      code: 'unsupported_condition_offers',
    });
  });

  it('ignores a response after the active frame/context changes', async () => {
    mocks.postChatwootBridgeJson.mockResolvedValueOnce({
      ok: true,
      requestId: 'product-request-01',
      product,
    });
    const { post, promise } = run(null, { isCurrentAction: () => false });

    await promise;

    expect(post).not.toHaveBeenCalled();
  });

  it('does not forward malformed or mismatched server data', async () => {
    mocks.postChatwootBridgeJson.mockResolvedValueOnce({
      ok: true,
      requestId: 'other-request',
      product: { ...product, cost_price: 1 },
    });
    const { post, promise } = run(null);

    await promise;

    expect(post).toHaveBeenCalledWith('baci-product-response:', {
      requestId: 'product-request-01',
      status: 'unavailable',
      code: 'product_unavailable',
    });
  });

  it('correlates an invalid-request response locally when the server cannot echo a request ID', async () => {
    mocks.postChatwootBridgeJson.mockResolvedValueOnce({
      ok: false,
      code: 'invalid_request',
    });
    const { post, promise } = run(null);

    await promise;

    expect(post).toHaveBeenCalledWith('baci-product-response:', {
      requestId: 'product-request-01',
      status: 'unavailable',
      code: 'invalid_request',
    });
  });

  it('rejects an invalid-request response with a mismatched request ID', async () => {
    mocks.postChatwootBridgeJson.mockResolvedValueOnce({
      ok: false,
      code: 'invalid_request',
      requestId: 'other-request',
    });
    const { post, promise } = run(null);

    await promise;

    expect(post).toHaveBeenCalledWith('baci-product-response:', {
      requestId: 'product-request-01',
      status: 'unavailable',
      code: 'product_unavailable',
    });
  });
});
