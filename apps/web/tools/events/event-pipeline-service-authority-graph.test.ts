import { describe, expect, it } from 'vitest';
import { serviceAuthorityGraphFindings } from './event-pipeline-service-authority-graph';

const service = 'apps/web/src/lib/supabase/service.ts';
const admin = 'apps/web/src/lib/supabase/admin.ts';

describe('event pipeline service authority graph', () => {
  it.each([
    'apps/web/src/lib/drain-storefront-cache-invalidation.ts',
    'apps/web/src/lib/strict-cloudflare-hostname-purge.ts',
  ])('rejects an extra credential import from B0 module %s', (root) => {
    const env = 'apps/web/src/env.ts';
    const route = 'apps/web/src/app/api/cron/security-probe/route.ts';
    const sources = new Map([
      [root, "import { getSupabaseServiceRoleKey } from '@/env';"],
      [env, 'use(process.env.SUPABASE_SERVICE_ROLE_KEY);'],
    ]);
    if (root !== route && !root.includes('/app/api/')) {
      sources.set(
        route,
        `import '${root.replace('apps/web/src/', '@/').replace(/\.ts$/, '')}';`
      );
    }
    const productionRoot = root.includes('/app/api/') ? root : route;
    expect(serviceAuthorityGraphFindings(sources, [productionRoot])).toContain(
      `${productionRoot}: API import graph reaches credential authority ${env}${productionRoot === root ? '' : ` via ${productionRoot} -> ${root} -> ${env}`}`
    );
  });

  it('treats a test-named bridge as production when a route reaches it', () => {
    const route = 'apps/web/src/app/api/fourth/route.ts';
    const bridge = 'apps/web/src/lib/events/authority-bridge.test.ts';
    const sources = new Map([
      [route, "import '@/lib/events/authority-bridge.test';"],
      [
        bridge,
        "import { createClient } from '@supabase/supabase-js/dist/index.mjs'; createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);",
      ],
    ]);
    expect(serviceAuthorityGraphFindings(sources)).toContain(
      `${bridge}: unauthorized sdk factory importer`
    );
  });
  it('rejects a credential-only test bridge reached by a production route', () => {
    const route = 'apps/web/src/app/api/fourth/route.ts';
    const bridge = 'apps/web/src/lib/events/credential-bridge.spec.ts';
    const sources = new Map([
      [route, "import '@/lib/events/credential-bridge.spec';"],
      [bridge, 'use(process.env.SUPABASE_SERVICE_ROLE_KEY);'],
    ]);
    expect(serviceAuthorityGraphFindings(sources)).toContain(
      `${bridge}: service-role credential read is forbidden`
    );
  });
  it('ignores a standalone test-named authority module', () => {
    const test = 'apps/web/src/lib/events/standalone-authority.spec.ts';
    const sources = new Map([
      [
        test,
        "import { createClient } from '@supabase/supabase-js'; createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);",
      ],
    ]);
    expect(serviceAuthorityGraphFindings(sources)).toEqual([]);
  });
  it('allows the request-scoped server client', () => {
    const path = 'apps/web/src/app/dashboard/settings/actions.ts';
    const sources = new Map([
      [path, "import { createClient } from '@/lib/supabase/server';"],
      [
        'apps/web/src/lib/supabase/server.ts',
        'export const createClient = () => null;',
      ],
    ]);
    expect(serviceAuthorityGraphFindings(sources, [path])).toEqual([]);
  });
  it.each([
    [
      'apps/mobile-admin/hooks/useAuth.ts',
      "import type { Session } from '@supabase/supabase-js'; export type State = { session: Session };",
    ],
    [
      'apps/web/src/app/api/fourth/route.ts',
      "export { type ServiceClient } from '@/lib/supabase/service';",
    ],
    [
      'apps/web/src/app/api/fourth/route.ts',
      "export type { ServiceClient } from '@/lib/supabase/service';",
    ],
  ])('allows a type-only authority reference from %s', (path, source) => {
    const sources = new Map([
      [path, source],
      [service, 'export type ServiceClient = object;'],
    ]);
    expect(serviceAuthorityGraphFindings(sources, [path])).toEqual([]);
  });
  it('allows an SDK import without a service-role credential', () => {
    const path = 'apps/mobile-admin/lib/supabase.ts';
    const sources = new Map([
      [
        path,
        "import { createClient } from '@supabase/supabase-js'; createClient(url, anonKey);",
      ],
    ]);
    expect(serviceAuthorityGraphFindings(sources, [path])).toEqual([]);
  });
  it.each([
    ['@/lib/supabase/admin', admin, 'admin'],
    ['@/lib/supabase/service', service, 'service'],
  ])('rejects direct %s authority', (specifier, target, kind) => {
    const path = 'apps/web/src/lib/events/rogue-factory.ts';
    const sources = new Map([
      [path, `import '${specifier}';`],
      [target, 'export const createClient = () => null;'],
    ]);
    expect(serviceAuthorityGraphFindings(sources, [path])).toContain(
      `${path}: unauthorized ${kind} factory importer`
    );
  });

  it('rejects a deep SDK service-role construction', () => {
    const path = 'apps/web/src/lib/events/rogue-sdk-client.ts';
    const sources = new Map([
      [
        path,
        "import { createClient } from '@supabase/supabase-js/dist/index.mjs'; createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);",
      ],
    ]);
    expect(serviceAuthorityGraphFindings(sources, [path])).toEqual(
      expect.arrayContaining([
        `${path}: service-role credential read is forbidden`,
        `${path}: unauthorized sdk factory importer`,
      ])
    );
  });

  it.each([
    ['relative import', "import '../supabase/service';"],
    ['require call', "require('@/lib/supabase/service');"],
    ['literal dynamic import', "void import('@/lib/supabase/service');"],
  ])('rejects a static %s of the service factory', (_, source) => {
    const path = 'apps/web/src/lib/events/rogue-service-importer.ts';
    const sources = new Map([
      [path, source],
      [service, 'export const createServiceClient = () => null;'],
    ]);
    expect(serviceAuthorityGraphFindings(sources, [path])).toContain(
      `${path}: unauthorized service factory importer`
    );
  });

  it('subtracts an inherited helper edge but rejects a new route path to it', () => {
    const route = 'apps/web/src/app/api/fourth/route.ts';
    const helper = 'apps/web/src/lib/inherited-admin.ts';
    const frozen = new Map([
      [route, 'export const unchangedAuthority = true;'],
      [helper, "import '@/lib/supabase/admin';"],
      [admin, 'export const createAdminClient = () => null;'],
    ]);
    const current = new Map(frozen);
    current.set(route, 'export const nonAuthorityEdit = true;');
    expect(serviceAuthorityGraphFindings(current, [route], frozen)).toEqual([]);
    current.set(route, "import '@/lib/inherited-admin';");
    expect(serviceAuthorityGraphFindings(current, [route], frozen)).toEqual([
      expect.stringContaining(`${route} -> ${helper} -> ${admin}`),
    ]);
  });

  it('uses static-edge subtraction instead of callable occurrence tracking', () => {
    const path = 'apps/web/src/lib/events/inherited-service-importer.ts';
    const importSource =
      "import { createServiceClient } from '@/lib/supabase/service';";
    const frozen = new Map([
      [path, importSource],
      [service, 'export const createServiceClient = () => null;'],
    ]);
    const current = new Map(frozen);
    current.set(path, `${importSource} Promise.resolve(createServiceClient);`);
    expect(serviceAuthorityGraphFindings(current, [path], frozen)).toEqual([]);
  });

  it('freezes raw bytes only when the caller supplies an inherited path', () => {
    const path = 'apps/web/src/lib/events/inherited-service-importer.ts';
    const importSource = "import '@/lib/supabase/service';";
    const frozen = new Map([
      [path, importSource],
      [service, 'export const createServiceClient = () => null;'],
    ]);
    const current = new Map(frozen);
    current.set(path, `${importSource} // comment`);
    expect(
      serviceAuthorityGraphFindings(
        current,
        [path],
        frozen,
        new Set([path]),
        frozen
      )
    ).toContain(
      `${path}: inherited event-pipeline authority source bytes changed`
    );
  });

  it.each([
    ["import { getSupabaseUrl as url } from '@/env';", false],
    ["export type { getSupabaseServiceRoleKey } from '@/env';", false],
    ["import { getSupabaseServiceRoleKey } from '@/env';", true],
    ["export { getSupabaseServiceRoleKey } from '@/env';", true],
    ["import * as env from '@/env';", true],
    ["void import('@/env');", true],
  ])('classifies credential bindings precisely', (source, forbidden) => {
    const route = 'apps/web/src/app/api/fourth/route.ts';
    const sources = new Map([
      [route, source],
      [
        'apps/web/src/env.ts',
        "export const getSupabaseUrl = () => 'url'; export const getSupabaseServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY;",
      ],
    ]);
    const found = serviceAuthorityGraphFindings(sources, [route]).some(
      (message) => message.includes('credential authority')
    );
    expect(found).toBe(forbidden);
  });

  it('does not promote an ordinary governed module to a production root', () => {
    const helper = 'apps/web/src/lib/events/jwt-helper.ts';
    const env = 'apps/web/src/env.ts';
    const sources = new Map([
      [helper, "import { getSupabaseJwtSecret } from '@/env';"],
      [
        env,
        'export const getSupabaseJwtSecret = () => process.env.SUPABASE_SERVICE_ROLE_KEY;',
      ],
    ]);

    expect(serviceAuthorityGraphFindings(sources, [helper])).toEqual([]);
  });

  it('rejects an indirect path to the declared test client', () => {
    const route = 'apps/web/src/app/api/fourth/route.ts';
    const facade = 'apps/web/src/lib/events/service-facade.ts';
    const client =
      'apps/web/src/lib/events/event-pipeline-service-role-test-client.ts';
    const sources = new Map([
      [route, "import '@/lib/events/service-facade';"],
      [
        facade,
        "export * from '@/lib/events/event-pipeline-service-role-test-client';",
      ],
      [client, 'export const client = {};'],
    ]);
    expect(serviceAuthorityGraphFindings(sources)).toEqual([
      expect.stringContaining(`${route} -> ${facade} -> ${client}`),
    ]);
  });

  it.each([
    [
      'apps/web/src/app/dashboard/orders/actions.ts',
      "'use server'; import '@/scripts/process-domain-events';",
    ],
    [
      'apps/web/src/pages/api/process-events.ts',
      "import '@/scripts/process-domain-events'; export default function handler() {}",
    ],
    [
      'apps/web/src/app/worker-status/page.tsx',
      "import '@/scripts/process-domain-events'; export default function Page() { return null; }",
    ],
    [
      'apps/web/src/instrumentation.ts',
      "import '@/scripts/process-domain-events';",
    ],
  ])('rejects a production surface that reaches a declared worker', (path, source) => {
    const worker = 'apps/web/src/scripts/process-domain-events.ts';
    const sources = new Map([
      [path, source],
      [worker, "import '@/lib/supabase/service';"],
      [service, 'export const createServiceClient = () => null;'],
    ]);
    expect(serviceAuthorityGraphFindings(sources)).toContain(
      `${path}: production surface import graph reaches service authority ${worker}`
    );
  });

  it('allows declared worker roots', () => {
    const worker = 'apps/web/src/scripts/process-domain-events.ts';
    const internal = 'apps/web/src/lib/events/domain-event-worker-loop.ts';
    const sources = new Map([
      [worker, "import '@/lib/supabase/service';"],
      [internal, "import '@/scripts/process-domain-events';"],
      [service, 'export const createServiceClient = () => null;'],
    ]);
    expect(serviceAuthorityGraphFindings(sources, [worker, internal])).toEqual(
      []
    );
  });

  it('recognizes JavaScript-family route roots', () => {
    const route = 'apps/web/src/app/api/fourth/route.jsx';
    const facade = 'apps/web/src/lib/events/service-facade.ts';
    const client =
      'apps/web/src/lib/events/event-pipeline-service-role-test-client.ts';
    const sources = new Map([
      [route, "import '@/lib/events/service-facade';"],
      [
        facade,
        "export * from '@/lib/events/event-pipeline-service-role-test-client';",
      ],
      [client, 'export const client = {};'],
    ]);
    expect(serviceAuthorityGraphFindings(sources)).toEqual([
      expect.stringContaining(`${route} -> ${facade} -> ${client}`),
    ]);
  });
});
