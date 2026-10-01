import { describe, expect, it } from 'vitest';
import { eventPipelineJumiaLoaderCredentialPaths } from './event-pipeline-jumia-loader-credential-paths';

const LOADER_CLIENT =
  'apps/web/src/lib/jumia/jumia-credential-loader-client.ts';
const ENV_PATH = 'apps/web/src/env.ts';

describe('eventPipelineJumiaLoaderCredentialPaths', () => {
  it('terminates every loader path at the environment module', () => {
    expect(eventPipelineJumiaLoaderCredentialPaths.length).toBeGreaterThan(0);
    for (const path of eventPipelineJumiaLoaderCredentialPaths) {
      expect(path.at(-1)).toBe(ENV_PATH);
      expect(path).toContain(LOADER_CLIENT);
    }
  });

  it('covers the audited API-route loader chains without duplicates', () => {
    const serialized = eventPipelineJumiaLoaderCredentialPaths.map((path) =>
      path.join(' -> ')
    );
    expect(new Set(serialized).size).toBe(serialized.length);
    expect(eventPipelineJumiaLoaderCredentialPaths).toContainEqual([
      'apps/web/src/app/api/marketplace/jumia/orders/route.ts',
      'apps/web/src/lib/jumia/client.ts',
      'apps/web/src/lib/jumia/jumia-client-config.ts',
      'apps/web/src/lib/jumia/load-jumia-authorization-grant.ts',
      LOADER_CLIENT,
      'apps/web/src/lib/supabase/scoped-jwt.ts',
      'apps/web/src/lib/agentic/jwt-signing-material.ts',
      ENV_PATH,
    ]);
    expect(eventPipelineJumiaLoaderCredentialPaths).toContainEqual([
      'apps/web/src/app/api/marketplace/jumia/connect/route.ts',
      'apps/web/src/app/api/marketplace/jumia/connect/post.ts',
      'apps/web/src/app/api/marketplace/jumia/connect/self-authorization-connect-request.ts',
      'apps/web/src/app/api/marketplace/jumia/connect/validate-jumia-self-authorization-for-connect.ts',
      'apps/web/src/lib/jumia/jumia-authorization-refresh-lease.ts',
      'apps/web/src/lib/jumia/load-jumia-authorization-grant.ts',
      LOADER_CLIENT,
      'apps/web/src/lib/supabase/scoped-jwt.ts',
      'apps/web/src/lib/agentic/jwt-signing-material.ts',
      ENV_PATH,
    ]);
  });
});
