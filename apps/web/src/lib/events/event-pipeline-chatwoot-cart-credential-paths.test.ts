import { expect, it } from 'vitest';
import { eventPipelineChatwootCartCredentialPaths as paths } from './event-pipeline-chatwoot-cart-credential-paths';

it('lists only the four context routes, the quantity, add and product routes and their shared scoped-cart helpers', () => {
  const helper = 'apps/web/src/lib/chatwoot/cart-context.ts';
  const tail = [
    'apps/web/src/lib/cart/scoped-client.ts',
    'apps/web/src/lib/agentic/jwt-signing-material.ts',
    'apps/web/src/env.ts',
  ];
  expect(paths).toEqual([
    [
      'apps/web/src/app/api/storefront/chatwoot/context/authorize/route.ts',
      helper,
      ...tail,
    ],
    [
      'apps/web/src/app/api/storefront/chatwoot/context/challenge/route.ts',
      helper,
      ...tail,
    ],
    [
      'apps/web/src/app/api/storefront/chatwoot/context/verify/route.ts',
      helper,
      ...tail,
    ],
    [
      'apps/web/src/app/api/storefront/chatwoot/context/delivery-options/route.ts',
      helper,
      ...tail,
    ],
    [
      'apps/web/src/app/api/storefront/chatwoot/cart/quantity/route.ts',
      ...tail,
    ],
    [
      'apps/web/src/app/api/storefront/chatwoot/cart/add/route.ts',
      helper,
      ...tail,
    ],
    [
      'apps/web/src/app/api/storefront/chatwoot/cart/add/route.ts',
      'apps/web/src/lib/chatwoot/commit-cart-add.ts',
      ...tail,
    ],
    [
      'apps/web/src/app/api/storefront/chatwoot/products/route.ts',
      helper,
      ...tail,
    ],
    [
      'apps/web/src/app/api/storefront/chatwoot/bank-verification/route.ts',
      helper,
      ...tail,
    ],
    [
      'apps/web/src/app/api/storefront/chatwoot/checkout-turn/route.ts',
      helper,
      ...tail,
    ],
    [
      'apps/web/src/app/api/storefront/chatwoot/delivery-confirmation/route.ts',
      helper,
      ...tail,
    ],
    ['apps/web/src/lib/chatwoot/commit-cart-add.ts', ...tail],
    [helper, ...tail],
  ]);
});
