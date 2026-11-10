import { expect, it } from 'vitest';
import { eventPipelineChatwootCartCredentialPaths as paths } from './event-pipeline-chatwoot-cart-credential-paths';

it('lists only the three context routes and their shared scoped-cart helper', () => {
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
    [helper, ...tail],
  ]);
});
