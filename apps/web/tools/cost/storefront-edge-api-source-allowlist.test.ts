import { describe, expect, it } from 'vitest';
import { isStorefrontRequiredApiSourcePath } from './storefront-edge-api-source-allowlist';

describe('isStorefrontRequiredApiSourcePath', () => {
  it('admits reviewed customer storefront APIs and excludes control-plane handlers', () => {
    for (const path of [
      'orders',
      'orders/credit-direct/client-completion',
      'orders/reuse',
      'quiz/events',
      'quiz/attempts/start',
      'quiz/attempts/[attemptId]/answers',
      'shipping/locations',
      'agentic/catalog/search',
      'agentic/checkout_sessions/[id]',
      'agentic/orders/[id]',
      'analytics/facebook-capi',
      'google-places/reviews',
      'places/autocomplete',
      'places/details',
      'search/submissions',
    ]) {
      expect(
        isStorefrontRequiredApiSourcePath(
          `apps/web/src/app/api/${path}/route.ts`
        )
      ).toBe(true);
    }
    expect(
      isStorefrontRequiredApiSourcePath(
        'apps/web/src/app/api/storefront/orders/[id]/route.ts'
      )
    ).toBe(true);
    expect(
      isStorefrontRequiredApiSourcePath(
        'apps/web/src/app/api/orders/[id]/route.ts'
      )
    ).toBe(false);
    expect(
      isStorefrontRequiredApiSourcePath(
        'apps/web/src/app/api/admin/db-health/route.ts'
      )
    ).toBe(false);
    expect(
      isStorefrontRequiredApiSourcePath(
        'apps/web/src/app/api/cron/gigl-tracking/route.ts'
      )
    ).toBe(false);
    expect(
      isStorefrontRequiredApiSourcePath(
        'apps/web/src/app/api/agentic/internal/replay/route.ts'
      )
    ).toBe(false);
    expect(
      isStorefrontRequiredApiSourcePath(
        'apps/web/src/app/api/analytics/facebook-capi-helper/route.ts'
      )
    ).toBe(false);
  });

  it('admits JavaScript route handlers (.js, .jsx, .tsx)', () => {
    expect(
      isStorefrontRequiredApiSourcePath('apps/web/src/app/api/orders/route.js')
    ).toBe(true);
    expect(
      isStorefrontRequiredApiSourcePath(
        'apps/web/src/app/api/storefront/orders/[id]/route.jsx'
      )
    ).toBe(true);
    expect(
      isStorefrontRequiredApiSourcePath(
        'apps/web/src/app/api/cart/validate/route.tsx'
      )
    ).toBe(true);
  });

  it('rejects non-route files regardless of extension', () => {
    expect(
      isStorefrontRequiredApiSourcePath('apps/web/src/app/api/orders/utils.ts')
    ).toBe(false);
  });
});

it('keeps every Oxygen endpoint on the dynamic origin without admitting unknown siblings', async () => {
  const { createStorefrontEdgeApiRows } = await import(
    './create-storefront-edge-api-rows'
  );
  const endpoints = [
    'activation-trial',
    'approval-code',
    'attempts',
    'availability',
    'bank-details',
    'chat',
    'draft',
    'order-plan',
    'phone-handoff/redeem',
    'plans',
    'plans/accept',
    'plans/quote',
    'reconcile',
    'recovery',
    'residential-context',
    'session',
    'webhook',
    'workflows',
    'workflows/actions',
    'workflows/phone-handoff',
    'workflows/selfie-status',
  ];
  const paths = endpoints.map(
    (endpoint) => `apps/web/src/app/api/payments/oxygen/${endpoint}/route.ts`
  );
  for (const sourcePath of paths)
    expect(isStorefrontRequiredApiSourcePath(sourcePath)).toBe(true);
  const rows = createStorefrontEdgeApiRows(
    'apps/web/src/app/api',
    paths.map((sourcePath) => ({
      sourcePath,
      bytes: Buffer.from('export async function POST() {}'),
    }))
  );
  expect(rows).toHaveLength(endpoints.length);
  for (const row of rows) expect(row.decision).toBe('origin_dynamic');
  expect(
    isStorefrontRequiredApiSourcePath(
      'apps/web/src/app/api/payments/oxygen/unreviewed/route.ts'
    )
  ).toBe(false);
});
