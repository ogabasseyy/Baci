import { describe, expect, it } from 'vitest';
import { serviceAuthorityGraphFindings } from './event-pipeline-service-authority-graph';

const helper = 'apps/web/src/lib/chatwoot/cart-context.ts';
const client = 'apps/web/src/lib/cart/scoped-client.ts';
const material = 'apps/web/src/lib/agentic/jwt-signing-material.ts';
const env = 'apps/web/src/env.ts';
const routes = ['authorize', 'challenge', 'verify'].map(
  (name) => `apps/web/src/app/api/storefront/chatwoot/context/${name}/route.ts`
);
const sources = () =>
  new Map([
    ...routes.map((route): [string, string] => [
      route,
      "import '@/lib/chatwoot/cart-context';",
    ]),
    [helper, "import '@/lib/cart/scoped-client';"],
    [client, "import '@/lib/agentic/jwt-signing-material';"],
    [material, "import { getSupabaseServiceRoleKey } from '@/env';"],
    [env, 'use(process.env.SUPABASE_SERVICE_ROLE_KEY);'],
  ]);

describe('Chatwoot scoped cart signing authority', () => {
  it('permits only the exact existing route and helper paths to the scoped cart client', () => {
    expect(
      serviceAuthorityGraphFindings(sources(), [...routes, helper], new Map())
    ).toEqual([]);
  });
  it('rejects sibling routes and direct access to the signing material or environment', () => {
    const graph = sources();
    const sibling =
      'apps/web/src/app/api/storefront/chatwoot/context/other/route.ts';
    graph.set(sibling, "import '@/lib/chatwoot/cart-context';");
    expect(
      serviceAuthorityGraphFindings(graph, [sibling], new Map()).join('\n')
    ).toContain('credential authority');
    for (const target of ['@/env', '@/lib/agentic/jwt-signing-material']) {
      const modified = sources();
      modified.set(routes[0], `import '${target}';`);
      expect(
        serviceAuthorityGraphFindings(modified, [routes[0]], new Map()).join(
          '\n'
        )
      ).toContain('credential authority');
    }
  });
  it('rejects shortcut paths and sibling helpers', () => {
    const helperShortcut = sources();
    helperShortcut.set(helper, "import '@/env';");
    expect(
      serviceAuthorityGraphFindings(helperShortcut, [helper], new Map()).join(
        '\n'
      )
    ).toContain('credential authority');

    const routeShortcut = sources();
    routeShortcut.set(routes[0], "import '@/lib/cart/scoped-client';");
    expect(
      serviceAuthorityGraphFindings(routeShortcut, [routes[0]], new Map()).join(
        '\n'
      )
    ).toContain('credential authority');

    const siblingHelper = 'apps/web/src/lib/chatwoot/unrelated-context.ts';
    const graph = sources();
    graph.set(siblingHelper, "import '@/lib/chatwoot/cart-context';");
    expect(
      serviceAuthorityGraphFindings(graph, [siblingHelper], new Map()).join(
        '\n'
      )
    ).toContain('credential authority');
  });
  it('does not authorize service factories through the Chatwoot helper', () => {
    const graph = sources();
    graph.set(
      helper,
      "import { createServiceClient } from '@/lib/supabase/service';"
    );
    graph.set(
      'apps/web/src/lib/supabase/service.ts',
      'export const createServiceClient = () => null;'
    );
    expect(
      serviceAuthorityGraphFindings(graph, [helper], new Map()).join('\n')
    ).toContain('unauthorized service factory importer');
  });
});
