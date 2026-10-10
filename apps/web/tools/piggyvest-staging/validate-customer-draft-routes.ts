import { readFileSync } from 'node:fs';
import { customerDraftProxyRoutes } from './customer-draft-proxy-routes';

type GeneratedRoute = {
  src?: string;
  dest?: string;
  methods?: string[];
  handle?: string;
};

type GeneratedConfig = {
  version?: number;
  routes?: GeneratedRoute[];
};

export type RouteVerdict = {
  rule: string;
  pass: boolean;
  detail: string;
};

type Resolution =
  | { kind: 'proxy'; dest: string }
  | { kind: 'filesystem' }
  | { kind: 'miss' };

// Assumption A1: `src` matches the request pathname only; the query string is
// preserved and passed through (per Vercel Build Output API routing). The live
// public battery (catalogue with ?merchantId=&page=) confirms this empirically.
function resolveRoute(
  routes: GeneratedRoute[],
  method: string,
  pathname: string
): Resolution {
  for (const route of routes) {
    if (route.handle === 'filesystem') return { kind: 'filesystem' };
    if (route.handle !== undefined) continue;
    if (route.src === undefined) continue;
    let matched = false;
    try {
      matched = new RegExp(route.src).test(pathname);
    } catch {
      continue;
    }
    if (!matched) continue;
    // A present `methods` list that excludes the request method falls through
    // to later routes instead of rejecting: unmatched methods must land on the
    // filesystem handler (Next 404/405), never on the staging upstream.
    if (route.methods !== undefined && !route.methods.includes(method))
      continue;
    if (route.dest !== undefined) return { kind: 'proxy', dest: route.dest };
  }
  return { kind: 'miss' };
}

const DRAFT_BASE = '/api/storefront/customer/savings/drafts';

export function validateCustomerDraftRoutes(
  config: GeneratedConfig
): RouteVerdict[] {
  const verdicts: RouteVerdict[] = [];
  const check = (rule: string, pass: boolean, detail: string) =>
    verdicts.push({ rule, pass, detail });
  const routes = config.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    return [{ rule: 'routes-present', pass: false, detail: 'no routes array' }];
  }
  const expected = customerDraftProxyRoutes();
  const positions = expected.map((want) =>
    routes.findIndex(
      (route) =>
        route.src === want.src &&
        route.dest === want.dest &&
        JSON.stringify(route.methods ?? null) ===
          JSON.stringify(want.methods ?? null)
    )
  );
  check(
    'exact-routes-present-verbatim',
    positions.every((position) => position >= 0),
    `positions=${positions.join(',')}`
  );
  const filesystemIndex = routes.findIndex(
    (route) => route.handle === 'filesystem'
  );
  check(
    'filesystem-handler-present',
    filesystemIndex >= 0,
    `index=${filesystemIndex}`
  );
  check(
    'routes-before-filesystem',
    filesystemIndex >= 0 &&
      positions.every(
        (position) => position >= 0 && position < filesystemIndex
      ),
    `positions=${positions.join(',')} filesystem=${filesystemIndex}`
  );
  const proxied: [string, string, string][] = [
    ['GET', DRAFT_BASE, `https://staging-auth.ogabassey.com${DRAFT_BASE}`],
    ['POST', DRAFT_BASE, `https://staging-auth.ogabassey.com${DRAFT_BASE}`],
    [
      'GET',
      `${DRAFT_BASE}/policy`,
      `https://staging-auth.ogabassey.com${DRAFT_BASE}/policy`,
    ],
    [
      'POST',
      `${DRAFT_BASE}/policy`,
      `https://staging-auth.ogabassey.com${DRAFT_BASE}/policy`,
    ],
    [
      'GET',
      `${DRAFT_BASE}/catalogue`,
      `https://staging-auth.ogabassey.com${DRAFT_BASE}/catalogue`,
    ],
  ];
  for (const [method, pathname, dest] of proxied) {
    const resolution = resolveRoute(routes, method, pathname);
    check(
      `proxied:${method} ${pathname}`,
      resolution.kind === 'proxy' && resolution.dest === dest,
      JSON.stringify(resolution)
    );
  }
  const filesystem: [string, string][] = [
    ['PUT', DRAFT_BASE],
    ['DELETE', DRAFT_BASE],
    ['PATCH', `${DRAFT_BASE}/policy`],
    ['PUT', `${DRAFT_BASE}/catalogue`],
    ['POST', `${DRAFT_BASE}/catalogue`],
    ['GET', '/api/webhooks/piggyvest'],
    ['POST', '/api/webhooks/piggyvest'],
    ['GET', '/api/storefront/customer/wallet/piggyvest-plan'],
    ['POST', '/api/storefront/customer/savings/cancel'],
    ['POST', '/rest/v1/rpc/customer_savings_draft_command'],
    ['GET', '/api/storefront/customer/savings/drafts-extra'],
    ['GET', `${DRAFT_BASE}/extra`],
  ];
  for (const [method, pathname] of filesystem) {
    const resolution = resolveRoute(routes, method, pathname);
    check(
      `filesystem:${method} ${pathname}`,
      resolution.kind === 'filesystem',
      JSON.stringify(resolution)
    );
  }
  check(
    'staging-only-destinations',
    JSON.stringify(routes).indexOf('https://ogabassey.com') === -1,
    'no production destination'
  );
  return verdicts;
}

function main(): number {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: validate-customer-draft-routes.mjs <config.json>');
    return 2;
  }
  const config = JSON.parse(readFileSync(file, 'utf8')) as GeneratedConfig;
  const verdicts = validateCustomerDraftRoutes(config);
  let failed = 0;
  for (const verdict of verdicts) {
    if (!verdict.pass) failed += 1;
    console.log(
      `${verdict.pass ? 'PASS' : 'FAIL'} ${verdict.rule} ${verdict.detail}`
    );
  }
  console.log(`${verdicts.length - failed}/${verdicts.length} checks passed`);
  return failed === 0 ? 0 : 1;
}

const invokedAsScript =
  typeof process.argv[1] === 'string' &&
  process.argv[1].endsWith('validate-customer-draft-routes.ts');
if (invokedAsScript) process.exit(main());
