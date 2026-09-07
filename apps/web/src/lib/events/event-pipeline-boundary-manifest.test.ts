import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const modulePath = resolve(
  process.cwd(),
  'src/lib/events/event-pipeline-boundary-manifest.ts'
);

describe('event pipeline authority manifest', () => {
  it('freezes every direct database projection and RPC classification', async () => {
    expect(existsSync(modulePath), 'boundary manifest is missing').toBe(true);
    if (!existsSync(modulePath)) return;

    const moduleUrl = pathToFileURL(modulePath).href;
    const { eventPipelineBoundaryManifest: manifest } = await import(
      /* @vite-ignore */ moduleUrl
    );
    expect(manifest.projections.identity).toEqual({
      domains: ['merchant_id'],
      merchant_slug_aliases: ['merchant_id'],
      merchants: ['id'],
    });
    expect(manifest.projections.paidDelivery).toEqual({
      order_items: ['id', 'product_id', 'name', 'price', 'quantity'],
      orders: [
        'id',
        'merchant_id',
        'order_number',
        'payment_status',
        'total',
        'currency',
        'customer_email',
        'customer_phone',
        'customer_name',
        'customer_id',
        'shipping_address',
        'ad_tracking',
      ],
    });
    expect(manifest.functions.typescriptApplication).toHaveLength(18);
    expect(manifest.functions.vpsCleanup).toEqual([
      'cleanup_domain_event_pipeline_v1',
    ]);
    expect(manifest.functions.sqlInternal).toEqual([
      'is_event_ingress_capability_v1',
      'replay_event_delivery_v1',
    ]);
    expect(manifest.functions.serviceRoleMetrics).toEqual([
      'get_domain_event_queue_metrics_v1',
    ]);
  });

  it('pins the eight compatibility route receipts and two Task 6 wrappers', async () => {
    expect(existsSync(modulePath), 'boundary manifest is missing').toBe(true);
    if (!existsSync(modulePath)) return;
    const moduleUrl = pathToFileURL(modulePath).href;
    const { eventPipelineBoundaryManifest: manifest } = await import(
      /* @vite-ignore */ moduleUrl
    );
    expect(manifest.frozenRoutes).toEqual({
      'apps/web/src/app/api/analytics/ads/route.ts':
        'dc74e421113d3447a816559282bcd0612c49d68d92403cafe5e9cb7001a35e50',
      'apps/web/src/app/api/analytics/facebook-capi/route.ts':
        'f41e1de587645b8fdb2af8af180eb581b2bfeecae688670d7b5c7a80088b7c32',
      'apps/web/src/app/api/analytics/ga4/route.ts':
        '9e9b8c3edb1636d2f27e9551568d5036778fce6ab54272f1fd3b77cfd0f88c9f',
      'apps/web/src/app/api/analytics/snapchat/route.ts':
        '1a7898d59038b6a37e057e74da3907f4a42da9c25c7236e9d324d7b1516e4cd3',
      'apps/web/src/app/api/analytics/tiktok/route.ts':
        '4d59510f6a72ae25dd45c8cc8ea6762a709bf745286140a7a9e1aa4b64ee942e',
      'apps/web/src/app/api/platform/events/route.ts':
        'bb3b5ea163f7029bd8a90523ac7944c9e126b2aebc0ce673f82c4e0c48d00161',
      'apps/web/src/app/api/orders/route.ts':
        '5b605dd9d0d34a040400c5d61d8c81401c6b0a8026513f34835b01ceafc13672',
      'apps/web/src/app/api/payments/juicyway/webhook/route.ts':
        'a8748056acf57c8fe4aea5b5dbf6a2bbcd1599e7aa57af3130cf95c277e61ef5',
    });
    expect(manifest.trustedWrapperImporters).toEqual([
      'apps/web/src/app/api/analytics/conversion/route.ts',
      'apps/web/src/app/api/events/route.ts',
    ]);
    expect(manifest.sdkConstructorHashes).toEqual({
      'apps/web/src/lib/events/event-ingress-capability.ts':
        '5e0cf13d22315a021e6a122604563777f0ecc22a1a88faed003daa3bee0db64c',
      'apps/web/src/lib/events/event-pipeline-test-client.ts':
        '4979380981132de46400971d9a626629db654df139f17321dceef7f4d0b6e713',
    });
  });

  it('binds the anon regression to the exact grant and JSON-key sweeps', () => {
    const sqlPath = resolve(
      process.cwd(),
      '../../supabase/migrations/tests/restore_merchants_anon_public_columns.sql'
    );
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain('expected_public_cols text[]');
    expect(sql).toContain('expected_published_merchant_keys text[]');
    expect(sql).toContain('expected_feature_setting_keys text[]');
    expect(sql).toContain('pg_get_functiondef');
    expect(sql).toContain('FROM pg_policies');
    expect(sql).toContain('pg_get_expr');
    expect(sql).toContain('is_published IS TRUE');
    expect(sql).toContain('effective anon merchant RLS is not published-only');
    expect(sql).toContain('repairs_catalog_enabled');
    expect(sql).toContain('cardinality(expected_feature_setting_keys) <> 62');
    expect(sql).toContain('2026-08-24');
  });
});
