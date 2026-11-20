// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { parseChatwootTenantBindings } from './commerce-context-bindings';

const firstMerchant = '11111111-1111-4111-8111-111111111111';
const secondMerchant = '22222222-2222-4222-8222-222222222222';
const sharedOrigin = 'https://supporter-custom-domain.example:443/';

function binding(merchantId: string, websiteToken: string, inboxId: number) {
  return {
    merchantId,
    origin: sharedOrigin,
    websiteToken,
    inboxId,
  };
}

describe('Chatwoot tenant binding parser', () => {
  it('normalizes custom-domain origins and allows distinct merchants to share one exact origin', () => {
    expect(
      parseChatwootTenantBindings(
        JSON.stringify([
          binding(firstMerchant, 'public-widget-token-first', 41),
          binding(secondMerchant, 'public-widget-token-second', 42),
        ])
      )
    ).toEqual([
      {
        merchantId: firstMerchant,
        origin: 'https://supporter-custom-domain.example',
        websiteToken: 'public-widget-token-first',
        inboxId: 41,
      },
      {
        merchantId: secondMerchant,
        origin: 'https://supporter-custom-domain.example',
        websiteToken: 'public-widget-token-second',
        inboxId: 42,
      },
    ]);
  });

  it.each([
    [
      binding(firstMerchant, 'public-widget-token-first', 41),
      binding(firstMerchant.toUpperCase(), 'public-widget-token-second', 42),
    ],
    [
      binding(firstMerchant, 'public-widget-token-first', 41),
      binding(secondMerchant, 'public-widget-token-first', 42),
    ],
    [
      binding(firstMerchant, 'public-widget-token-first', 41),
      binding(secondMerchant, 'public-widget-token-second', 41),
    ],
  ])('rejects duplicate merchant, token, or inbox identities', (...bindings) => {
    expect(parseChatwootTenantBindings(JSON.stringify(bindings))).toBeNull();
  });

  it('fails closed for malformed or ambiguous origin configuration', () => {
    expect(parseChatwootTenantBindings(undefined)).toBeNull();
    expect(parseChatwootTenantBindings('not-json')).toBeNull();
    expect(
      parseChatwootTenantBindings(
        JSON.stringify([
          {
            ...binding(firstMerchant, 'public-widget-token-first', 41),
            origin: 'https://shop.example.com/path',
          },
        ])
      )
    ).toBeNull();
  });
});
