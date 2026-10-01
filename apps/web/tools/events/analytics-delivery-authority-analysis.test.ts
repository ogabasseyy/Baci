import { describe, expect, it } from 'vitest';
import { analyzeAnalyticsDeliveryAuthoritySources } from './analytics-delivery-authority-analysis';

const conversion = 'apps/web/src/app/api/analytics/conversion/route.ts';
const events = 'apps/web/src/app/api/events/route.ts';
const wrapper =
  'apps/web/src/lib/analytics/trusted-server-ad-platform-fanout.ts';
const config = 'apps/web/src/lib/analytics/fetch-analytics-platform-config.ts';
const platformRoute = 'apps/web/src/app/api/platform/events/route.ts';
const wrapperImport =
  "import { trustedServerAdPlatformFanout as fanout } from '@/lib/analytics/trusted-server-ad-platform-fanout'; import { createServiceClient } from '@/lib/supabase/service';";
const contextImports =
  "import { resolveConversionRouteMerchantContext } from './conversion-route-merchant-context'; import { resolveLegacyFanoutContext } from './resolve-legacy-fanout-context'; import { resolveEventIngressContext } from '@/lib/events/event-ingress-context';";
function validSources() {
  return new Map([
    [
      conversion,
      `${wrapperImport} ${contextImports} const merchantContext = await resolveConversionRouteMerchantContext(); const verifiedMerchantId = merchantContext.verifiedMerchantId; const results = !verifiedMerchantId ? {} : fanout(createServiceClient('event-pipeline'), verifiedMerchantId, event);`,
    ],
    [
      events,
      `${wrapperImport} ${contextImports} let verifiedFanoutMerchantId = null; verifiedFanoutMerchantId = await resolveLegacyFanoutContext(); if (verifiedFanoutMerchantId) { const resolvedMerchantId = verifiedFanoutMerchantId; after(() => fanout(createServiceClient('event-pipeline'), resolvedMerchantId, event)); }`,
    ],
    [
      wrapper,
      "import 'server-only'; import { fetchAnalyticsPlatformConfig } from './fetch-analytics-platform-config'; export const trusted = () => fetchAnalyticsPlatformConfig(client, id);",
    ],
    [config, 'export const fetchAnalyticsPlatformConfig = () => null;'],
    [platformRoute, 'export const POST = () => null;'],
  ]);
}
describe('analytics delivery authority source analysis', () => {
  it('accepts approved verified aliases and importers', () => {
    const sources = validSources();
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toEqual([]);
  });
  it('rejects a verified guard paired with a different context merchant property', () => {
    const sources = validSources();
    sources.set(
      conversion,
      `${wrapperImport} ${contextImports} const merchantContext = await resolveConversionRouteMerchantContext(); const verifiedMerchantId = merchantContext.verifiedMerchantId; const context = await resolveEventIngressContext(); if (verifiedMerchantId) fanout(createServiceClient('event-pipeline'), context.merchantId, event);`
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${conversion}: body-selected merchant authority`
    );
  });
  it('rejects parameters shadowing trusted verification and merchant aliases', () => {
    const sources = validSources();
    sources.set(
      conversion,
      `${wrapperImport} ${contextImports} const merchantContext = await resolveConversionRouteMerchantContext(); const verifiedMerchantId = merchantContext.verifiedMerchantId; const resolvedMerchantId = verifiedMerchantId; function deliver(verifiedMerchantId: boolean, resolvedMerchantId: string) { if (verifiedMerchantId) fanout(createServiceClient('event-pipeline'), resolvedMerchantId, event); }`
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toEqual(
      expect.arrayContaining([
        `${conversion}: privileged construction before verified tenant context`,
        `${conversion}: body-selected merchant authority`,
      ])
    );
  });
  it.each([
    [
      'verified merchant alias from request input',
      'const verifiedMerchantId = input.merchant_id; if (verifiedMerchantId) { SERVICE }',
    ],
    [
      'resolved merchant alias from request input',
      'const resolvedMerchantId = input.merchant_id; if (resolvedMerchantId) { SERVICE }',
    ],
    [
      'untrusted context verified property',
      'const context = input; if (context.ok && context.verified) { SERVICE }',
    ],
    [
      'unguarded resolver context merchant assignment',
      'const context = await resolveEventIngressContext(); let verifiedFanoutMerchantId = null; verifiedFanoutMerchantId = context.merchantId; if (verifiedFanoutMerchantId) { SERVICE }',
    ],
  ])('rejects %s', (_name, body) => {
    const sources = validSources();
    sources.set(
      conversion,
      `${wrapperImport} ${contextImports} ${body.replace('SERVICE', "fanout(createServiceClient('event-pipeline'), input.merchant_id, event)")}`
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${conversion}: privileged construction before verified tenant context`
    );
  });
  it.each([
    ['ok only', 'if (context.ok) { SERVICE }'],
    ['verified mention outside branch', 'void context.verified; SERVICE'],
    ['construction before branch', 'SERVICE; if (context.verified) { use(); }'],
    ['merchant id truthiness', 'if (context.merchantId) { SERVICE }'],
  ])('rejects %s', (_name, body) => {
    const sources = validSources();
    sources.set(
      conversion,
      `${wrapperImport} ${contextImports} ${body.replace('SERVICE', "fanout(createServiceClient('event-pipeline'), context.merchantId, event)")}`
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${conversion}: privileged construction before verified tenant context`
    );
  });
  it('rejects body-selected identity and repeated configuration reads', () => {
    const sources = validSources();
    sources.set(
      conversion,
      `${wrapperImport} ${contextImports} const context = await resolveEventIngressContext(); if (context.verified) fanout(createServiceClient('event-pipeline'), input.merchant_id, event);`
    );
    sources.set(
      wrapper,
      "import 'server-only'; import { fetchAnalyticsPlatformConfig } from './fetch-analytics-platform-config'; const load = fetchAnalyticsPlatformConfig; fetchAnalyticsPlatformConfig(client, id); load(client, id);"
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toEqual(
      expect.arrayContaining([
        `${conversion}: body-selected merchant authority`,
        `${wrapper}: configuration load count is 2, expected 1`,
      ])
    );
  });

  it('rejects a request-selected merchant hidden behind a local alias', () => {
    const sources = validSources();
    sources.set(
      conversion,
      `${wrapperImport} ${contextImports} const context = await resolveEventIngressContext(); const merchantId = input.merchant_id; if (context.verified) fanout(createServiceClient('event-pipeline'), merchantId, event);`
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${conversion}: body-selected merchant authority`
    );
  });

  it('does not treat a resolved merchant id as proof of verification', () => {
    const sources = validSources();
    sources.set(
      conversion,
      `${wrapperImport} ${contextImports} const context = await resolveEventIngressContext(); if (context.merchantId) fanout(createServiceClient('event-pipeline'), context.merchantId, event);`
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${conversion}: privileged construction before verified tenant context`
    );
  });

  it('rejects an unguarded aliased service construction', () => {
    const sources = validSources();
    sources.set(
      conversion,
      `${contextImports} import { trustedServerAdPlatformFanout as fanout } from '@/lib/analytics/trusted-server-ad-platform-fanout'; import { createServiceClient as makeService } from '@/lib/supabase/service'; const context = await resolveEventIngressContext(); if (context.verified) fanout(makeService('event-pipeline'), context.merchantId, event); fanout(makeService('event-pipeline'), context.merchantId, event);`
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${conversion}: service factory aliasing is forbidden`
    );
  });

  it('rejects a local helper spoofing verified conversion context', () => {
    const sources = validSources();
    sources.set(
      conversion,
      `${wrapperImport} function resolveConversionRouteMerchantContext() { return { verifiedMerchantId: input.merchant_id }; } const merchantContext = resolveConversionRouteMerchantContext(); const verifiedMerchantId = merchantContext.verifiedMerchantId; if (verifiedMerchantId) fanout(createServiceClient('event-pipeline'), verifiedMerchantId, event);`
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${conversion}: privileged construction before verified tenant context`
    );
  });

  it('rejects a nested binding shadowing the imported conversion resolver', () => {
    const sources = validSources();
    sources.set(
      conversion,
      `${wrapperImport} ${contextImports} { const resolveConversionRouteMerchantContext = () => ({ verifiedMerchantId: input.merchant_id }); const merchantContext = resolveConversionRouteMerchantContext(); const verifiedMerchantId = merchantContext.verifiedMerchantId; if (verifiedMerchantId) fanout(createServiceClient('event-pipeline'), verifiedMerchantId, event); }`
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${conversion}: privileged construction before verified tenant context`
    );
  });

  it('rejects a nested binding shadowing the imported event resolver', () => {
    const sources = validSources();
    sources.set(
      events,
      `${wrapperImport} ${contextImports} { const resolveLegacyFanoutContext = () => input.merchant_id; const verifiedFanoutMerchantId = resolveLegacyFanoutContext(); if (verifiedFanoutMerchantId) fanout(createServiceClient('event-pipeline'), verifiedFanoutMerchantId, event); }`
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${events}: privileged construction before verified tenant context`
    );
  });

  it('rejects destructuring that shadows an imported resolver', () => {
    const sources = validSources();
    sources.set(
      conversion,
      `${wrapperImport} ${contextImports} { const { resolveConversionRouteMerchantContext } = evil; const merchantContext = resolveConversionRouteMerchantContext(); const verifiedMerchantId = merchantContext.verifiedMerchantId; if (verifiedMerchantId) fanout(createServiceClient('event-pipeline'), verifiedMerchantId, event); }`
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${conversion}: privileged construction before verified tenant context`
    );
  });

  it.each([
    [
      're-export',
      "export { trustedServerAdPlatformFanout } from '@/lib/analytics/trusted-server-ad-platform-fanout';",
    ],
    [
      'aliased import',
      "import { trustedServerAdPlatformFanout as send } from '@/lib/analytics/trusted-server-ad-platform-fanout';",
    ],
    [
      'literal dynamic import',
      "void import('@/lib/analytics/trusted-server-ad-platform-fanout');",
    ],
  ])('rejects a third %s importer', (_name, source) => {
    const sources = validSources();
    const third = 'apps/web/src/app/api/analytics/third/route.ts';
    sources.set(third, source);
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${third}: unauthorized trusted wrapper importer`
    );
  });

  it('reports the complete browser-to-authority path', () => {
    const sources = validSources();
    const client = 'apps/web/src/client.ts';
    const facade = 'apps/web/src/facade.ts';
    sources.set(client, "'use client'; import './facade';");
    sources.set(
      facade,
      "export * from '@/lib/analytics/trusted-server-ad-platform-fanout';"
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${client}: client graph reaches privileged analytics authority: ${client} -> ${facade} -> ${wrapper}`
    );
  });

  it('does not accept a use server module as a client authority boundary', () => {
    const sources = validSources();
    const client = 'apps/web/src/late-client.ts';
    const facade = 'apps/web/src/late-facade.ts';
    sources.set(client, "'use client'; import './late-facade';");
    sources.set(
      facade,
      "'use server'; export * from '@/lib/analytics/trusted-server-ad-platform-fanout';"
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${client}: client graph reaches privileged analytics authority: ${client} -> ${facade} -> ${wrapper}`
    );
  });

  it('rejects a browser graph reaching a privileged factory directly', () => {
    const sources = validSources();
    const client = 'apps/web/src/direct-client.ts';
    const service = 'apps/web/src/lib/supabase/service.ts';
    sources.set(client, "'use client'; import '@/lib/supabase/service';");
    sources.set(service, 'export const createServiceClient = () => null;');
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${client}: client graph reaches privileged analytics authority: ${client} -> ${service}`
    );
    // biome-ignore format: exact provider roots stay visible within the 300-line test gate.
    for (const name of ['facebook-capi', 'facebook-capi-request', 'ga4-measurement-protocol', 'snapchat-capi', 'tiktok-events-api', 'tiktok-events-api-request']) {
      const providerClient = `apps/web/src/${name}-client.ts`;
      const provider = `apps/web/src/lib/${name}.ts`;
      sources.set(provider, 'export const send = () => null;');
      sources.set(providerClient, `'use client'; import '@/lib/${name}';`);
      expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
        `${providerClient}: client graph reaches privileged analytics authority: ${providerClient} -> ${provider}`
      );
    }
  });
  it('rejects forbidden imports and credential reads in the pure closure', () => {
    const sources = validSources();
    const root = 'apps/web/src/lib/analytics/send-configured-ad-platforms.ts';
    sources.set(
      root,
      "import '@/lib/supabase/service'; const { FACEBOOK_ACCESS_TOKEN } = process['env'];"
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toEqual(
      expect.arrayContaining([
        `${root}: pure provider closure reaches forbidden import @/lib/supabase/service`,
        `${root}: pure provider closure reads environment credentials`,
      ])
    );
  });

  it('rejects any route importing the retired platform helper', () => {
    const sources = validSources();
    const third = 'apps/web/src/app/api/platform/other/route.ts';
    sources.set(
      third,
      "import { forwardToPlatformAnalytics } from '@/app/api/platform/events/platform-event-forwarding';"
    );
    expect(analyzeAnalyticsDeliveryAuthoritySources(sources)).toContain(
      `${third}: retired platform authority helper importer`
    );
  });
});
