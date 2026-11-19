import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  add: vi.fn(async (input: { post: (value: unknown) => void }) =>
    input.post({ from: 'add' })
  ),
  quantity: vi.fn(async (input: { post: (value: unknown) => void }) =>
    input.post({ from: 'quantity' })
  ),
  review: vi.fn(() => ({ review: true })),
}));

vi.mock(
  '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-add',
  () => ({ handleChatwootInlineCartAdd: mocks.add })
);
vi.mock(
  '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-quantity',
  () => ({ handleChatwootInlineCartQuantity: mocks.quantity })
);
vi.mock(
  '@/components/storefront/ogabassey/components/chat/chatwoot-inline-review-response',
  () => ({ buildChatwootInlineReviewResponse: mocks.review })
);

import { dispatchChatwootInlineCartMutation } from './chatwoot-inline-cart-mutation-dispatch';

function run(event: string) {
  const postRaw = vi.fn();
  const snapshot = { snapshot: true };
  const promise = dispatchChatwootInlineCartMutation({
    lineTokens: ['t'],
    message: { event },
    postRaw,
    requestId: 'req-12345',
    sessionExpiresAt: 99_000,
    snapshot,
  } as unknown as Parameters<typeof dispatchChatwootInlineCartMutation>[0]);
  return { postRaw, promise, snapshot };
}

describe('dispatchChatwootInlineCartMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes quantity actions with the quantity result prefix', async () => {
    const { postRaw, promise } = run('baci-cart-quantity');
    await promise;
    expect(mocks.quantity).toHaveBeenCalledTimes(1);
    expect(mocks.quantity.mock.calls[0]?.[0]).toMatchObject({
      lineTokens: ['t'],
    });
    expect(mocks.add).not.toHaveBeenCalled();
    expect(postRaw).toHaveBeenCalledWith('baci-cart-quantity-result:', {
      from: 'quantity',
    });
  });

  it('routes add actions with the add result prefix and no line tokens', async () => {
    const { postRaw, promise } = run('baci-cart-add');
    await promise;
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.add.mock.calls[0]?.[0]).not.toHaveProperty('lineTokens');
    expect(mocks.quantity).not.toHaveBeenCalled();
    expect(postRaw).toHaveBeenCalledWith('baci-cart-add-result:', {
      from: 'add',
    });
  });

  it('answers checkout-review requests from the snapshot without a cart mutation', async () => {
    const { postRaw, promise, snapshot } = run('baci-checkout-review-request');
    await promise;
    expect(mocks.review).toHaveBeenCalledWith('req-12345', snapshot, 99);
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.quantity).not.toHaveBeenCalled();
    expect(postRaw).toHaveBeenCalledWith('baci-checkout-review:', {
      review: true,
    });
  });
});
