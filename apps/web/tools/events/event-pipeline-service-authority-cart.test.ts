import { describe, expect, it } from 'vitest';
import { serviceAuthorityGraphFindings } from './event-pipeline-service-authority-graph';

const route = 'apps/web/src/app/api/storefront/cart/commands/route.ts';
const client = 'apps/web/src/lib/cart/scoped-client.ts';
const signer = 'apps/web/src/lib/agentic/jwt-signing-material.ts';
const environment = 'apps/web/src/env.ts';
const sources = () =>
  new Map([
    [route, "import '@/lib/cart/scoped-client';"],
    [client, "import '@/lib/agentic/jwt-signing-material';"],
    [signer, "import { getSupabaseServiceRoleKey } from '@/env';"],
    [environment, 'use(process.env.SUPABASE_SERVICE_ROLE_KEY);'],
  ]);

describe('cart scoped signing authority', () => {
  it('records the exact cart route to scoped signer path', () => {
    expect(serviceAuthorityGraphFindings(sources(), [route])).toEqual([]);
  });
  it('records the receive-authority helper as an exact production root', () => {
    const helper = 'apps/web/src/lib/cart/realtime-access.ts';
    const graph = sources();
    graph.set(
      helper,
      "import '@/lib/cart/scoped-client'; export async function getCartRealtimeAccess() {}"
    );
    expect(serviceAuthorityGraphFindings(graph, [helper], new Map())).toEqual(
      []
    );
  });
  it('rejects sibling routes using the cart signer', () => {
    const graph = sources();
    const sibling = 'apps/web/src/app/api/other/route.ts';
    graph.set(sibling, "import '@/lib/cart/scoped-client';");
    expect(
      serviceAuthorityGraphFindings(graph, [sibling]).join('\n')
    ).toContain('credential authority');
  });
  it('never authorizes a service client through cart signing', () => {
    const graph = sources();
    graph.set(
      client,
      "import { createServiceClient } from '@/lib/supabase/service';"
    );
    graph.set(
      'apps/web/src/lib/supabase/service.ts',
      'export const createServiceClient = () => null;'
    );
    expect(serviceAuthorityGraphFindings(graph, [route]).join('\n')).toContain(
      'unauthorized service factory importer'
    );
  });
});
