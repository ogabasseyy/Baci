import { expect, it } from 'vitest';
import { eventPipelineCartCredentialPaths as paths } from './event-pipeline-cart-credential-paths';

it('records only exact cart scoped-signing paths, not service factories', () => {
  expect(paths).toHaveLength(17);
  expect(new Set(paths.map((p) => JSON.stringify(p))).size).toBe(paths.length);
  for (const path of paths) {
    if (path[0] !== 'apps/web/src/lib/agentic/ucp-canonical-cart.ts')
      expect(path[0]).toMatch(
        /^apps\/web\/src\/(app\/api\/storefront\/cart\/|lib\/cart\/(?:scoped-client|realtime-access|device-session|account-link|legacy-canonical-bridge|legacy-scoped-client)\.ts)/
      );
    expect(path.slice(-3)).toEqual([
      path.includes('apps/web/src/lib/cart/legacy-scoped-client.ts')
        ? 'apps/web/src/lib/cart/legacy-scoped-client.ts'
        : 'apps/web/src/lib/cart/scoped-client.ts',
      'apps/web/src/lib/agentic/jwt-signing-material.ts',
      'apps/web/src/env.ts',
    ]);
    expect(
      path.some(
        (p) =>
          p.endsWith('/supabase/service.ts') || p.endsWith('/supabase/admin.ts')
      )
    ).toBe(false);
  }
});
