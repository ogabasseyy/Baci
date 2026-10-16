import { expect, it } from 'vitest';
import { serviceAuthorityGraphFindings } from './event-pipeline-service-authority-graph';

const route =
  'apps/web/src/app/api/orders/[id]/shipping/checkout-recovery/route.ts';
const helper =
  'apps/web/src/lib/shipping/prepare-checkout-shipping-recovery.ts';
const signer = 'apps/web/src/lib/shipping/shipping-quote-route-proof.ts';
const env = 'apps/web/src/env.ts';
function sources(root = route) {
  return new Map([
    [root, "import '@/lib/shipping/prepare-checkout-shipping-recovery';"],
    [helper, "import 'server-only'; import './shipping-quote-route-proof';"],
    [
      signer,
      "import 'server-only'; import { getSupabaseServiceRoleKey } from '@/env';",
    ],
    [
      env,
      'export const getSupabaseServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY;',
    ],
  ]);
}
it('permits only the audited recovery route through its fixed-action helper', () => {
  expect(serviceAuthorityGraphFindings(sources(), [route])).toEqual([]);
});
it('rejects a sibling route attempting to reuse the signing helper', () => {
  const sibling =
    'apps/web/src/app/api/orders/[id]/shipping/unreviewed/route.ts';
  expect(
    serviceAuthorityGraphFindings(sources(sibling), [sibling]).join('\n')
  ).toContain(`${sibling}: API import graph reaches credential authority`);
});
it('rejects direct generic signing from the recovery route', () => {
  const graph = sources();
  graph.set(route, "import '@/lib/shipping/shipping-quote-route-proof';");
  expect(serviceAuthorityGraphFindings(graph, [route]).join('\n')).toContain(
    `${route}: API import graph reaches credential authority`
  );
});
