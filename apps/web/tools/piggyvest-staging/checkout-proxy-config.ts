import { createHash } from 'node:crypto';
import { checkoutProxyConfigSchema } from './schemas/checkout-proxy-config';

const paths = [
  {
    path: '/api/storefront/customer/savings/card-checkout',
    methods: ['GET', 'POST', 'PATCH'],
  },
  { path: '/savings/card-return', methods: ['GET', 'HEAD'] },
  { path: '/api/csrf', methods: ['GET'] },
];
const unavailablePath = '/api/storefront/customer/savings/card-contributions';
const assetPattern = '^/savings/card-assets/_next/static/([A-Za-z0-9_./-]+)$';
const assetProbe = '/savings/card-assets/_next/static/css/first-card.css';

export function checkoutProxyConfig(input: unknown, baselineSha256: string) {
  try {
    if (!/^[a-f0-9]{64}$/.test(baselineSha256)) throw new Error();
    const bytes = JSON.stringify(input);
    if (createHash('sha256').update(bytes).digest('hex') !== baselineSha256)
      throw new Error();
    const config = checkoutProxyConfigSchema.parse(input);
    const terminal = config.routes.at(-1);
    if (terminal?.handle !== 'filesystem' || Object.keys(terminal).length !== 1)
      throw new Error();
    for (const route of config.routes.slice(0, -1)) {
      if ('handle' in route || typeof route.src !== 'string') throw new Error();
      const matcher = new RegExp(route.src);
      if (
        paths.some(({ path }) => matcher.test(path)) ||
        matcher.test(unavailablePath) ||
        matcher.test(assetProbe)
      )
        throw new Error();
    }
    return {
      version: 3,
      routes: [
        ...config.routes.slice(0, -1),
        ...paths.flatMap(({ path, methods }) => [
          {
            src: `^${path}$`,
            dest: `https://staging-auth.ogabassey.com${path}`,
            methods,
          },
          { src: `^${path}$`, status: 405 },
        ]),
        {
          src: assetPattern,
          dest: 'https://staging-auth.ogabassey.com/savings/card-assets/_next/static/$1',
          methods: ['GET', 'HEAD'],
        },
        { src: assetPattern, status: 405 },
        { handle: 'filesystem' },
      ],
    };
  } catch {
    throw new Error('Unexpected staging checkout proxy baseline');
  }
}
