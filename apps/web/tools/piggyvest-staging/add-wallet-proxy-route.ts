import { isDeepStrictEqual } from 'node:util';
import { customerDraftProxyRoutes } from './customer-draft-proxy-routes';
import { customerFundingRoutes } from './customer-funding-routes';

export function addWalletProxyRoute(config: unknown) {
  const funding = customerFundingRoutes().proxyRoutes;
  const baselineRoutes = [
    ...customerDraftProxyRoutes(),
    ...funding,
    ...funding.map(({ src }) => ({ src, status: 405 })),
    { handle: 'filesystem' },
  ];
  if (!isDeepStrictEqual(config, { version: 3, routes: baselineRoutes })) {
    throw new Error('Unexpected staging wallet proxy baseline');
  }
  return {
    version: 3,
    routes: [
      ...baselineRoutes.slice(0, -1),
      {
        src: '^/api/storefront/customer/wallet$',
        dest: 'https://staging-auth.ogabassey.com/api/storefront/customer/wallet',
        methods: ['GET'],
      },
      { src: '^/api/storefront/customer/wallet$', status: 405 },
      { handle: 'filesystem' },
    ],
  };
}
