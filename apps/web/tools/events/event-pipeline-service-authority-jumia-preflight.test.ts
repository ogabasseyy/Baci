import { describe, expect, it } from 'vitest';
import { serviceAuthorityGraphFindings } from './event-pipeline-service-authority-graph';

const client = 'apps/web/src/lib/jumia/client.ts';
const clientConfig = 'apps/web/src/lib/jumia/jumia-client-config.ts';
const grantLoader = 'apps/web/src/lib/jumia/load-jumia-authorization-grant.ts';
const credentialLoader =
  'apps/web/src/lib/jumia/jumia-credential-loader-client.ts';
const scopedJwt = 'apps/web/src/lib/supabase/scoped-jwt.ts';
const jwtSigningMaterial = 'apps/web/src/lib/agentic/jwt-signing-material.ts';
const environment = 'apps/web/src/env.ts';
const preflightRoute =
  'apps/web/src/app/api/marketplace/jumia/products/preflight/route.ts';

function sources(route: string) {
  return new Map([
    [route, "import '@/lib/jumia/client';"],
    [
      client,
      "import { getJumiaClientId } from '@/env'; import '@/lib/jumia/jumia-client-config';",
    ],
    [
      clientConfig,
      "import { getJumiaAuthorizationEncryptionKey } from '@/env'; import '@/lib/jumia/load-jumia-authorization-grant';",
    ],
    [grantLoader, "import '@/lib/jumia/jumia-credential-loader-client';"],
    [credentialLoader, "import '@/lib/supabase/scoped-jwt';"],
    [scopedJwt, "import '@/lib/agentic/jwt-signing-material';"],
    [jwtSigningMaterial, "import { getSupabaseServiceRoleKey } from '@/env';"],
    [
      environment,
      'export const getJumiaClientId = () => process.env.JUMIA_CLIENT_ID; const credential = process.env.SUPABASE_SERVICE_ROLE_KEY;',
    ],
  ]);
}

describe('Jumia preflight credential authority root', () => {
  it('allows only the registered preflight route to use its Jumia client path', () => {
    expect(
      serviceAuthorityGraphFindings(sources(preflightRoute), [preflightRoute])
    ).toEqual([]);

    const adjacentRoute =
      'apps/web/src/app/api/marketplace/jumia/products/preflight-preview/route.ts';
    expect(
      serviceAuthorityGraphFindings(sources(adjacentRoute), [adjacentRoute])
    ).toContain(
      `${adjacentRoute}: API import graph reaches credential authority ${environment} via ${adjacentRoute} -> ${client} -> ${environment}`
    );
  });
});
