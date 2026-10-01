import { describe, expect, it } from 'vitest';
import { serviceAuthorityGraphFindings } from './event-pipeline-service-authority-graph';

const route = 'apps/web/src/app/api/integrations/ads/google/sync/route.ts';
const helper = 'apps/web/src/lib/ads/server-spend-client.ts';
const credentialHelper = 'apps/web/src/lib/ads/server-credential-client.ts';
const service = 'apps/web/src/lib/supabase/service.ts';

describe('Ads event-pipeline service authority graph', () => {
  it('allows only an exact manifested service-wrapper path', () => {
    const sources = new Map([
      [route, "import '@/lib/ads/server-spend-client';"],
      [helper, "import '@/lib/supabase/service';"],
      [service, 'export const createServiceClient = () => null;'],
    ]);

    expect(serviceAuthorityGraphFindings(sources, [route])).toEqual([]);
    const unauthorized = 'apps/web/src/app/api/integrations/ads/fifth/route.ts';
    sources.set(unauthorized, "import '@/lib/ads/server-spend-client';");
    expect(serviceAuthorityGraphFindings(sources, [unauthorized])).toContain(
      `${unauthorized}: API import graph reaches service authority ${helper}`
    );
  });

  it('allows only an exact manifested Ads credential-wrapper path', () => {
    const credentialRoute =
      'apps/web/src/app/api/integrations/ads/google/accounts/route.ts';
    const sources = new Map([
      [credentialRoute, `import '@/lib/ads/server-credential-client';`],
      [credentialHelper, "import '@/lib/supabase/service';"],
      [service, 'export const createServiceClient = () => null;'],
    ]);

    expect(serviceAuthorityGraphFindings(sources, [credentialRoute])).toEqual(
      []
    );
    const unauthorized = 'apps/web/src/app/api/integrations/ads/fifth/route.ts';
    sources.set(unauthorized, "import '@/lib/ads/server-credential-client';");
    expect(serviceAuthorityGraphFindings(sources, [unauthorized])).toContain(
      `${unauthorized}: API import graph reaches service authority ${credentialHelper}`
    );
  });
});
