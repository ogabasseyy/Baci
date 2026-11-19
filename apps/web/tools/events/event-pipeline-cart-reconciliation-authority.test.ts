import { describe, expect, it } from 'vitest';
import { serviceAuthorityGraphFindings } from './event-pipeline-service-authority-graph';

const route =
  'apps/web/src/app/api/storefront/cart/checkout/reconcile/route.ts';
const client = 'apps/web/src/lib/cart/checkout-reconciliation-client.ts';
const signer = 'apps/web/src/lib/agentic/jwt-signing-material.ts';
const env = 'apps/web/src/env.ts';

function sources() {
  return new Map([
    [route, "import '@/lib/cart/checkout-reconciliation-client';"],
    [
      client,
      "import 'server-only'; import '@/lib/agentic/jwt-signing-material';",
    ],
    [signer, "import { getSupabaseServiceRoleKey } from '@/env';"],
    [env, 'use(process.env.SUPABASE_SERVICE_ROLE_KEY);'],
  ]);
}

describe('cart checkout reconciliation signing authority', () => {
  it.each([
    route,
    client,
  ])('allows only the reviewed signer path from %s', (root) => {
    expect(serviceAuthorityGraphFindings(sources(), [root], new Map())).toEqual(
      []
    );
  });

  it('rejects a sibling route importing the reconciliation client', () => {
    const graph = sources();
    const sibling = 'apps/web/src/app/api/storefront/cart/unreviewed/route.ts';
    graph.set(sibling, "import '@/lib/cart/checkout-reconciliation-client';");
    expect(
      serviceAuthorityGraphFindings(graph, [sibling], new Map()).join('\n')
    ).toContain(`${sibling}: API import graph reaches credential authority`);
  });

  it('rejects direct signing from the reconciliation route', () => {
    const graph = sources();
    graph.set(route, "import '@/lib/agentic/jwt-signing-material';");
    expect(
      serviceAuthorityGraphFindings(graph, [route], new Map()).join('\n')
    ).toContain(`${route}: API import graph reaches credential authority`);
  });

  it('does not authorize a service-role factory through the client', () => {
    const graph = sources();
    graph.set(
      client,
      "import { createServiceClient } from '@/lib/supabase/service';"
    );
    graph.set(
      'apps/web/src/lib/supabase/service.ts',
      'export const createServiceClient = () => null;'
    );
    expect(
      serviceAuthorityGraphFindings(graph, [route], new Map()).join('\n')
    ).toContain('unauthorized service factory importer');
  });

  it('rejects a direct service-role credential read by the client', () => {
    const graph = sources();
    graph.set(
      client,
      "import { getSupabaseServiceRoleKey } from '@/env'; getSupabaseServiceRoleKey();"
    );
    expect(
      serviceAuthorityGraphFindings(graph, [route], new Map()).join('\n')
    ).toContain(`${route}: API import graph reaches credential authority`);
  });
});
