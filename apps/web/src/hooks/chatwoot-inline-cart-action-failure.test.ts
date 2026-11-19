import { describe, expect, it, vi } from 'vitest';
import { postChatwootInlineCartActionFailure } from './chatwoot-inline-cart-action-failure';

describe('postChatwootInlineCartActionFailure', () => {
  it('returns bounded failures for cart view, quantity, and review actions', () => {
    const post = vi.fn();
    for (const event of [
      'baci-cart-request',
      'baci-cart-quantity',
      'baci-checkout-review-request',
    ] as const) {
      postChatwootInlineCartActionFailure({
        event,
        requestId: 'request-0001',
        post,
      });
    }

    expect(post.mock.calls).toEqual([
      [
        'baci-cart-view:',
        { requestId: 'request-0001', ready: false, items: [] },
      ],
      [
        'baci-cart-quantity-result:',
        { requestId: 'request-0001', accepted: false },
      ],
      [
        'baci-checkout-review:',
        { requestId: 'request-0001', status: 'unavailable' },
      ],
    ]);
  });

  it('returns a failed add result for an invalid context', () => {
    const post = vi.fn();

    postChatwootInlineCartActionFailure({
      event: 'baci-cart-add',
      requestId: 'add-request-01',
      post,
    });

    expect(post).toHaveBeenCalledWith('baci-cart-add-result:', {
      requestId: 'add-request-01',
      accepted: false,
      code: 'invalid_context',
    });
  });
});
