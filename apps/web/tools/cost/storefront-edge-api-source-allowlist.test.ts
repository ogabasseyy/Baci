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
