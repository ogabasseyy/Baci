import { describe, expect, it } from 'vitest';
import { analyzeAnalyticsDeliveryAuthoritySources } from './analytics-delivery-authority-analysis';

const conversion = 'apps/web/src/app/api/analytics/conversion/route.ts';
const events = 'apps/web/src/app/api/events/route.ts';
const wrapper =
  'apps/web/src/lib/analytics/trusted-server-ad-platform-fanout.ts';
const config = 'apps/web/src/lib/analytics/fetch-analytics-platform-config.ts';
const platformRoute = 'apps/web/src/app/api/platform/events/route.ts';
const imports =
  "import { createServiceClient } from '@/lib/supabase/service'; import { trustedServerAdPlatformFanout as fanout } from '@/lib/analytics/trusted-server-ad-platform-fanout'; import { resolveConversionRouteMerchantContext } from './conversion-route-merchant-context';";

function validSources() {
  return new Map([
    [
      conversion,
      `${imports} const merchantContext = await resolveConversionRouteMerchantContext(); const verifiedMerchantId = merchantContext.verifiedMerchantId; if (verifiedMerchantId) fanout(createServiceClient('event-pipeline'), verifiedMerchantId, event);`,
    ],
    [
      events,
      "import { createServiceClient } from '@/lib/supabase/service'; import { trustedServerAdPlatformFanout as fanout } from '@/lib/analytics/trusted-server-ad-platform-fanout'; import { resolveLegacyFanoutContext } from './resolve-legacy-fanout-context'; const verifiedFanoutMerchantId = await resolveLegacyFanoutContext(); if (verifiedFanoutMerchantId) fanout(createServiceClient('event-pipeline'), verifiedFanoutMerchantId, event);",
    ],
    [
      wrapper,
      "import 'server-only'; import { fetchAnalyticsPlatformConfig } from './fetch-analytics-platform-config'; fetchAnalyticsPlatformConfig(client, id);",
    ],
    [config, 'export const fetchAnalyticsPlatformConfig = () => null;'],
    [platformRoute, 'export const POST = () => null;'],
  ]);
}

describe('analytics authority review regressions', () => {
  it('finds a require-based fourth trusted wrapper importer', () => {
    const sources = validSources();
    const fourth = 'apps/web/src/app/api/fourth/route.ts';
    sources.set(
      fourth,
      "const wrapper = require('@/lib/analytics/trusted-server-ad-platform-fanout');"
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${fourth}: unauthorized trusted wrapper importer`
    );
  });

  it('rejects reintroduced direct platform forwarding imports and helper files', () => {
    const sources = validSources();
    sources.set(
      platformRoute,
      "import { forwardToPlatformAnalytics } from './platform-event-forwarding';"
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${platformRoute}: retired platform authority helper importer`
    );
    sources.set(platformRoute, 'export const POST = () => null;');
    const helper =
      'apps/web/src/app/api/platform/events/platform-event-forwarding.ts';
    sources.set(
      helper,
      'export const forwardToPlatformAnalytics = () => null;'
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${helper}: retired platform authority helper is present`
    );
  });

  it('traverses a use-server facade when checking direct factory reachability', () => {
    const sources = validSources();
    const client = 'apps/web/src/client.ts';
    const facade = 'apps/web/src/facade.ts';
    const service = 'apps/web/src/lib/supabase/service.ts';
    sources.set(client, "'use client'; import './facade';");
    sources.set(
      facade,
      "'use server'; export * from '@/lib/supabase/service';"
    );
    sources.set(service, 'export const createServiceClient = () => null;');
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${client}: client graph reaches privileged analytics authority: ${client} -> ${facade} -> ${service}`
    );
  });

  it.each([
    'const alias = merchantContext; alias.verifiedMerchantId = input.merchant_id;',
    'leak(merchantContext);',
  ])('rejects trusted context alias mutation or escape: %s', (attack) => {
    const sources = validSources();
    sources.set(
      conversion,
      `${imports} const merchantContext = await resolveConversionRouteMerchantContext(); ${attack} const verifiedMerchantId = merchantContext.verifiedMerchantId; if (verifiedMerchantId) fanout(createServiceClient('event-pipeline'), verifiedMerchantId, event);`
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${conversion}: privileged construction before verified tenant context`
    );
  });
});
