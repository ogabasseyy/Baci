import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { eventPipelineAuthorityServicePaths } from './event-pipeline-authority-service-paths';
import { authorityFindings } from './event-pipeline-boundary-manifest';

const modulePath = resolve(
  process.cwd(),
  'src/lib/events/event-pipeline-boundary-manifest.ts'
);

describe('event pipeline authority importer boundary', () => {
  it.each([
    'apps/web/src/app/api/orders/route.ts',
    'apps/web/src/app/api/payments/juicyway/webhook/route.ts',
  ])('allows %s to import but not construct the admin client', (path) => {
    const importOnly = ts.createSourceFile(
      path,
      "import { createAdminClient } from '@/lib/supabase/admin';",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    expect(authorityFindings(path, importOnly)).toEqual([]);
    const construction = ts.createSourceFile(
      path,
      "import { createAdminClient } from '@/lib/supabase/admin'; createAdminClient('event-pipeline');",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    expect(authorityFindings(path, construction)).toContain(
      `${path}: privileged route client construction is forbidden`
    );
  });

  it('pins the finite privileged-factory importer sets', async () => {
    expect(existsSync(modulePath), 'boundary manifest is missing').toBe(true);
    if (!existsSync(modulePath)) return;
    const moduleUrl = pathToFileURL(modulePath).href;
    const { eventPipelineBoundaryManifest: manifest } = await import(
      /* @vite-ignore */ moduleUrl
    );

    expect(manifest.authority.adminImporters).toEqual([
      'apps/web/src/app/api/orders/route.ts',
      'apps/web/src/app/api/payments/juicyway/webhook/route.ts',
      'apps/web/src/app/api/platform/events/platform-event-forwarding.ts',
      'apps/web/src/app/api/shipping/quotes/route.ts',
      'apps/web/src/lib/events/record-platform-order-created-event.ts',
      'apps/web/src/lib/expo-push.ts',
      'apps/web/src/lib/insurance/notify-activate-protection.ts',
      'apps/web/src/lib/repair-notifications.ts',
      'apps/web/src/lib/shipping/persist-admin-gigl-quote.ts',
      'apps/web/src/lib/shipping/persist-refreshed-shipping-quote.ts',
    ]);
    expect(manifest.authority.serviceImporters).toEqual([
      'apps/web/src/app/api/cron/drain-cache-invalidations/route.ts',
      'apps/web/src/app/api/cron/gigl-tracking-notifications/route.ts',
      'apps/web/src/app/api/cron/gigl-tracking/route.ts',
      'apps/web/src/app/api/analytics/conversion/route.ts',
      'apps/web/src/app/api/events/route.ts',
      'apps/web/src/lib/events/event-pipeline-service-role-test-client.ts',
      'apps/web/src/lib/ads/server-credential-client.ts',
      'apps/web/src/lib/ads/server-spend-client.ts',
      'apps/web/src/lib/wallet/server-funding-recovery-hmac-client.ts',
      'apps/web/src/lib/shipping/server-shipping-quote-booking-economics-client.ts',
      'apps/web/src/scripts/process-domain-events.ts',
      'apps/web/src/scripts/process-event-deliveries.ts',
    ]);
    expect(manifest.authority.servicePaths).toEqual([
      ...eventPipelineAuthorityServicePaths,
    ]);
    expect(manifest.authority.operationalServiceImporters).toEqual([
      'apps/web/src/scripts/reconcile-paystack-unmatched-partial.ts',
    ]);
  });

  it('allows the dedicated Ads credential sentinel only in its server helper', () => {
    const helper = 'apps/web/src/lib/ads/server-credential-client.ts';
    const allowed = ts.createSourceFile(
      helper,
      "import { createServiceClient } from '@/lib/supabase/service'; createServiceClient('ads-credentials');",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    expect(authorityFindings(helper, allowed)).toEqual([]);

    const wrongSentinel = ts.createSourceFile(
      helper,
      "import { createServiceClient } from '@/lib/supabase/service'; createServiceClient('event-pipeline');",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    expect(authorityFindings(helper, wrongSentinel)).toContain(
      `${helper}: service factory requires ads-credentials sentinel`
    );

    const route = 'apps/web/src/app/api/integrations/ads/fourth/route.ts';
    const unlisted = ts.createSourceFile(
      route,
      "import { createServiceClient } from '@/lib/supabase/service'; createServiceClient('ads-credentials');",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    expect(authorityFindings(route, unlisted)).toEqual(
      expect.arrayContaining([
        `${route}: unauthorized service factory importer`,
        `${route}: service factory requires event-pipeline sentinel`,
        `${route}: privileged route client construction is forbidden`,
      ])
    );
  });

  it('allows the wallet funding-recovery HMAC sentinel only in its server helper', () => {
    const helper =
      'apps/web/src/lib/wallet/server-funding-recovery-hmac-client.ts';
    const allowed = ts.createSourceFile(
      helper,
      "import { createServiceClient } from '@/lib/supabase/service'; createServiceClient('wallet-funding-recovery');",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    expect(authorityFindings(helper, allowed)).toEqual([]);

    const wrongSentinel = ts.createSourceFile(
      helper,
      "import { createServiceClient } from '@/lib/supabase/service'; createServiceClient('event-pipeline');",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    expect(authorityFindings(helper, wrongSentinel)).toContain(
      `${helper}: service factory requires wallet-funding-recovery sentinel`
    );
  });

  it('allows the shipping-quote booking-economics sentinel only in its server helper', () => {
    const helper =
      'apps/web/src/lib/shipping/server-shipping-quote-booking-economics-client.ts';
    const allowed = ts.createSourceFile(
      helper,
      "import { createServiceClient } from '@/lib/supabase/service'; createServiceClient('shipping-quote-booking-economics');",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    expect(authorityFindings(helper, allowed)).toEqual([]);

    const wrongSentinel = ts.createSourceFile(
      helper,
      "import { createServiceClient } from '@/lib/supabase/service'; createServiceClient('event-pipeline');",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    expect(authorityFindings(helper, wrongSentinel)).toContain(
      `${helper}: service factory requires shipping-quote-booking-economics sentinel`
    );
  });

  it.each([
    'apps/web/src/lib/payments/file-stuck-credit-direct-review.ts',
    'apps/web/src/lib/payments/resolve-credit-direct-confirmation-review.ts',
  ])('rejects the retired admin importer %s', (path) => {
    const importOnly = ts.createSourceFile(
      path,
      "import { createAdminClient } from '@/lib/supabase/admin';",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    expect(authorityFindings(path, importOnly)).toContain(
      `${path}: unauthorized admin factory importer`
    );
  });

  it('rejects the Credit Direct webhook as a service importer', () => {
    const path = 'apps/web/src/app/api/payments/credit-direct/webhook/route.ts';
    const importOnly = ts.createSourceFile(
      path,
      "import { createServiceClient } from '@/lib/supabase/service';",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    expect(authorityFindings(path, importOnly)).toContain(
      `${path}: unauthorized trusted wrapper importer`
    );
  });

  it('rejects a namespace service factory in a fourth route', () => {
    const path = 'apps/web/src/app/api/fourth/route.ts';
    const source = ts.createSourceFile(
      path,
      "import * as svc from '@/lib/supabase/service'; svc.createServiceClient('event-pipeline');",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    expect(authorityFindings(path, source)).toEqual(
      expect.arrayContaining([
        `${path}: unauthorized trusted wrapper importer`,
        `${path}: unauthorized service factory importer`,
        `${path}: privileged route client construction is forbidden`,
      ])
    );
  });

  it('rejects a deep Supabase SDK factory import', () => {
    const path = 'apps/web/src/app/api/fourth/route.ts';
    const source = ts.createSourceFile(
      path,
      "import { createClient } from '@supabase/supabase-js/dist/index.mjs'; createClient(url, importedKey);",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    expect(authorityFindings(path, source)).toContain(
      `${path}: unauthorized privileged SDK factory importer`
    );
  });
});
