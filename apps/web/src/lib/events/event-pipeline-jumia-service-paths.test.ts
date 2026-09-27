import { describe, expect, it } from 'vitest';
import { eventPipelineJumiaServicePaths } from './event-pipeline-jumia-service-paths';

describe('eventPipelineJumiaServicePaths', () => {
  it('keeps the Jumia API client paths behind the credential wrapper', () => {
    expect(eventPipelineJumiaServicePaths).toContainEqual([
      'apps/web/src/app/api/marketplace/jumia/products/route.ts',
      'apps/web/src/lib/jumia/client.ts',
      'apps/web/src/lib/jumia/jumia-client-config.ts',
      'apps/web/src/lib/jumia/load-jumia-authorization-grant.ts',
      'apps/web/src/lib/jumia/server-credential-client.ts',
    ]);
  });

  it('includes the OAuth exchange and self-authorization boundaries', () => {
    expect(eventPipelineJumiaServicePaths).toContainEqual(
      expect.arrayContaining([
        'apps/web/src/app/api/marketplace/jumia/connect/exchange/route.ts',
        'apps/web/src/lib/jumia/client.ts',
        'apps/web/src/lib/jumia/server-credential-client.ts',
      ])
    );
    expect(eventPipelineJumiaServicePaths).toContainEqual(
      expect.arrayContaining([
        'apps/web/src/app/api/marketplace/jumia/connect/route.ts',
        'apps/web/src/app/api/marketplace/jumia/connect/self-authorization-connect-request.ts',
        'apps/web/src/lib/jumia/server-credential-client.ts',
      ])
    );
  });
});
