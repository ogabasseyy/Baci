import { expect, it } from 'vitest';
import { eventPipelineCartCredentialPaths as paths } from './event-pipeline-cart-credential-paths';

it('records only exact cart scoped-signing paths, not service factories', () => {
  expect(paths).toHaveLength(12);
  expect(new Set(paths.map((p) => JSON.stringify(p))).size).toBe(paths.length);
  for (const path of paths) {
    expect(path[0]).toMatch(
      /^apps\/web\/src\/(app\/api\/storefront\/cart\/|lib\/cart\/(?:scoped-client|realtime-access|device-session|account-link)\.ts)/
    );
    expect(path.slice(-3)).toEqual([
      'apps/web/src/lib/cart/scoped-client.ts',
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
