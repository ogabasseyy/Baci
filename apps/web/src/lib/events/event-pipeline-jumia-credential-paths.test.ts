import { describe, expect, it } from 'vitest';
import {
  clientCredentialSuffixes,
  eventPipelineJumiaCredentialPaths,
  jumiaApiRoutesUsingClient,
} from './event-pipeline-jumia-credential-paths';
import { eventPipelineJumiaServicePaths } from './event-pipeline-jumia-service-paths';

describe('eventPipelineJumiaCredentialPaths', () => {
  it('includes every audited API-route credential suffix', () => {
    for (const route of jumiaApiRoutesUsingClient) {
      for (const suffix of clientCredentialSuffixes) {
        expect(eventPipelineJumiaCredentialPaths).toContainEqual([
          route,
          ...suffix,
        ]);
      }
    }
  });

  it('includes callback and client persistence paths', () => {
    expect(eventPipelineJumiaCredentialPaths).toContainEqual([
      'apps/web/src/scripts/sync-jumia-orders.ts',
      'apps/web/src/lib/jumia/order-sync.ts',
      'apps/web/src/lib/jumia/client.ts',
      'apps/web/src/env.ts',
    ]);
    expect(eventPipelineJumiaCredentialPaths).toContainEqual([
      'apps/web/src/app/api/marketplace/jumia/callback/runtime-impl.ts',
      'apps/web/src/env.ts',
    ]);
    expect(eventPipelineJumiaCredentialPaths).toContainEqual([
      'apps/web/src/lib/jumia/client.ts',
      'apps/web/src/lib/jumia/jumia-client-token-persistence.ts',
      'apps/web/src/lib/jumia/helpers.ts',
      'apps/web/src/env.ts',
    ]);
  });

  it('pins the server-only credential wrapper paths', () => {
    expect(eventPipelineJumiaServicePaths).toContainEqual([
      'apps/web/src/app/api/marketplace/jumia/products/route.ts',
      'apps/web/src/lib/jumia/client.ts',
      'apps/web/src/lib/jumia/jumia-client-config.ts',
      'apps/web/src/lib/jumia/load-jumia-authorization-grant.ts',
      'apps/web/src/lib/jumia/server-credential-client.ts',
    ]);
    expect(eventPipelineJumiaServicePaths).toContainEqual([
      'apps/web/src/app/api/marketplace/jumia/connect/route.ts',
      'apps/web/src/app/api/marketplace/jumia/connect/post.ts',
      'apps/web/src/app/api/marketplace/jumia/connect/self-authorization-connect-request.ts',
      'apps/web/src/app/api/marketplace/jumia/connect/validate-jumia-self-authorization-for-connect.ts',
      'apps/web/src/lib/jumia/jumia-authorization-refresh-lease.ts',
      'apps/web/src/lib/jumia/load-jumia-authorization-grant.ts',
      'apps/web/src/lib/jumia/server-credential-client.ts',
    ]);
  });
});
