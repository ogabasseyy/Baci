import { describe, expect, it } from 'vitest';
import {
  readChatwootCommerceContextMessage,
  readChatwootCommerceMessage,
} from './chatwoot-commerce-message';
const frame = {} as Window;
const event = (origin: string, source: Window, message: unknown) =>
  ({
    origin,
    source,
    data: `${(message as { event: string }).event}:${JSON.stringify((message as { data: unknown }).data)}`,
  }) as MessageEvent;
const context = { conversationId: 905, sessionToken: 'signed-session-capability' };
describe('Chatwoot commerce messages', () => {
  it('accepts only bounded context signals from the exact widget frame and origin', () => {
    const request = {
      event: 'baci-commerce-context-request',
      data: {
        requestId: 'context_123456',
        conversationId: 905,
        websiteToken: 'synthetic-widget-token-123456',
        visitorTokenSha256: 'b'.repeat(64),
      },
    };
    expect(
      readChatwootCommerceContextMessage(
        event('https://widget.test', frame, request),
        'https://widget.test',
        frame
      )
    ).toEqual(request);
    expect(
      readChatwootCommerceContextMessage(
        event('https://evil.test', frame, request),
        'https://widget.test',
        frame
      )
    ).toBeNull();
    expect(
      readChatwootCommerceContextMessage(
        event('https://widget.test', {} as Window, request),
        'https://widget.test',
        frame
      )
    ).toBeNull();
  });

  it('accepts generated underscore product slugs in product and cart requests', () => {
    for (const msg of [
      {
        event: 'baci-product-request',
        data: { slug: 'iphone_13-pro', requestId: 'r1', ...context },
      },
      {
        event: 'baci-cart-add',
        data: {
          slug: 'iphone_13-pro',
          variantId: 'variant-1',
          displayedPrice: 100,
          requestId: 'r2',
          ...context,
        },
      },
    ]) {
      expect(
        readChatwootCommerceMessage(
          event('https://widget.test', frame, msg),
          'https://widget.test',
          frame
        )
      ).toEqual(msg);
    }
  });

  it('accepts an option request only from the exact widget frame and origin', () => {
    const msg = {
      event: 'baci-product-request',
      data: { slug: 'iphone-14', requestId: 'r1', ...context },
    };
    expect(
      readChatwootCommerceMessage(
        event('https://widget.test', frame, msg),
        'https://widget.test',
        frame
      )
    ).toEqual(msg);
    expect(
      readChatwootCommerceMessage(
        event('https://evil.test', frame, msg),
        'https://widget.test',
        frame
      )
    ).toBeNull();
    expect(
      readChatwootCommerceMessage(
        event('https://widget.test', {} as Window, msg),
        'https://widget.test',
        frame
      )
    ).toBeNull();
  });
  it('rejects invalid or incomplete add requests', () => {
    const msg = {
      event: 'baci-cart-add',
      data: {
        slug: '../admin',
        variantId: 'v1',
        displayedPrice: 0,
        requestId: 'r1', ...context,
      },
    };
    expect(
      readChatwootCommerceMessage(
        event('https://widget.test', frame, msg),
        'https://widget.test',
        frame
      )
    ).toBeNull();
  });
  it('accepts only bounded cart line changes', () => {
    const valid = { event: 'baci-cart-quantity', data: { requestId: 'r3', lineToken: 'line-1', expectedQuantity: 2, quantity: 3, ...context } };
    expect(readChatwootCommerceMessage(event('https://widget.test', frame, valid), 'https://widget.test', frame)).toEqual(valid);
    expect(readChatwootCommerceMessage(event('https://widget.test', frame, { ...valid, data: { ...valid.data, expectedQuantity: 12, quantity: 10 } }), 'https://widget.test', frame)).not.toBeNull();
    expect(readChatwootCommerceMessage(event('https://widget.test', frame, { ...valid, data: { ...valid.data, expectedQuantity: 1001 } }), 'https://widget.test', frame)).toBeNull();
    for (const quantity of [-1, 1.5, 1001]) {
      expect(readChatwootCommerceMessage(event('https://widget.test', frame, { ...valid, data: { ...valid.data, quantity } }), 'https://widget.test', frame)).toBeNull();
    }
    expect(readChatwootCommerceMessage(event('https://widget.test', frame, { ...valid, data: { ...valid.data, quantity: 21 } }), 'https://widget.test', frame)).not.toBeNull();
  });
  it('accepts a bounded cart view request from the widget', () => {
    const msg = { event: 'baci-cart-request', data: { requestId: 'r2', ...context } };
    expect(
      readChatwootCommerceMessage(
        event('https://widget.test', frame, msg),
        'https://widget.test',
        frame
      )
    ).toEqual(msg);
  });
  it('accepts only a request-id-only checkout review command', () => {
    const valid = { event: 'baci-checkout-review-request', data: { requestId: 'review-1', ...context } };
    expect(readChatwootCommerceMessage(event('https://widget.test', frame, valid), 'https://widget.test', frame)).toEqual(valid);
    expect(readChatwootCommerceMessage(event('https://widget.test', frame, { ...valid, data: { requestId: 'review-1', cartId: 'caller-selected' } }), 'https://widget.test', frame)).toBeNull();
  });

  it('accepts a full-size supported signed session token envelope', () => {
    const largeTokenMessage = {
      event: 'baci-cart-request',
      data: {
        requestId: 'request-1',
        conversationId: 905,
        sessionToken: 't'.repeat(2_380),
      },
    };
    expect(
      readChatwootCommerceMessage(
        event('https://widget.test', frame, largeTokenMessage),
        'https://widget.test',
        frame
      )
    ).toEqual(largeTokenMessage);
    expect(
      readChatwootCommerceMessage(
        {
          origin: 'https://widget.test',
          source: frame,
          data: `baci-cart-request:${'x'.repeat(24_001)}`,
        } as MessageEvent,
        'https://widget.test',
        frame
      )
    ).toBeNull();
  });
});
