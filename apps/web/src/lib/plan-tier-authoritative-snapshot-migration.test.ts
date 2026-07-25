import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATION_SOURCE = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260725120000_plan_tier_authoritative_snapshot_entitlement.sql'
  ),
  'utf8'
);

describe('plan_tier authoritative snapshot entitlement migration', () => {
  it('hardens merchants.plan_tier so the NOT NULL invariant is permanent', () => {
    // Backfill first so a replay/branch database cannot abort SET NOT NULL.
    expect(MIGRATION_SOURCE).toMatch(
      /UPDATE public\.merchants\s+SET plan_tier = 'free'\s+WHERE plan_tier IS NULL;/
    );
    expect(MIGRATION_SOURCE).toMatch(
      /ALTER TABLE public\.merchants\s+ALTER COLUMN plan_tier SET DEFAULT 'free';/
    );
    expect(MIGRATION_SOURCE).toMatch(
      /ALTER TABLE public\.merchants\s+ALTER COLUMN plan_tier SET NOT NULL;/
    );
    // The backfill must run before the constraint is asserted.
    expect(MIGRATION_SOURCE.indexOf('WHERE plan_tier IS NULL;')).toBeLessThan(
      MIGRATION_SOURCE.indexOf('SET NOT NULL;')
    );
  });

  it('derives price_negotiation_enabled from plan_tier alone', () => {
    expect(MIGRATION_SOURCE).toContain(
      'CREATE OR REPLACE FUNCTION public.resolve_storefront_public_snapshot_v2('
    );
    expect(MIGRATION_SOURCE).toContain(
      `      COALESCE(
        merchant_row.merchant_data->>'plan_tier' IN (
          'pro',
          'business',
          'enterprise'
        ),
        false
      ) AS price_negotiation_enabled,`
    );
    // The old CASE/ELSE slug branch is gone entirely.
    expect(MIGRATION_SOURCE).not.toContain('END AS price_negotiation_enabled');
  });

  describe('regression: hardcoded legacy premium-slug fallback', () => {
    it('never matches a merchant slug against a hardcoded allowlist', () => {
      // The previous definition fell back to two hardcoded storefront slugs
      // whenever plan_tier was NULL. plan_tier is now NOT NULL, so the
      // allowlist must not appear anywhere in this migration — comments
      // included.
      expect(MIGRATION_SOURCE).not.toContain('ogabassey');
      expect(MIGRATION_SOURCE).not.toContain('demo-premium');
      expect(MIGRATION_SOURCE).not.toContain(
        "merchant_row.merchant_data->>'slug'"
      );
    });
  });

  it('keeps the definer/search_path hardening and the locked-down grants', () => {
    expect(MIGRATION_SOURCE).toContain('SECURITY DEFINER');
    expect(MIGRATION_SOURCE).toContain("SET search_path TO ''");
    expect(MIGRATION_SOURCE).toMatch(
      /REVOKE ALL ON FUNCTION public\.resolve_storefront_public_snapshot_v2\(text\)\s+FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(MIGRATION_SOURCE).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.resolve_storefront_public_snapshot_v2\(text\)\s+TO anon, authenticated, service_role;/
    );
    // The broad service-only resolver must never regain anon access here.
    expect(MIGRATION_SOURCE).not.toContain(
      'GRANT EXECUTE ON FUNCTION public.resolve_storefront_cached_merchant'
    );
  });

  it('exposes the derived hint but no raw plan_tier on the published projection', () => {
    expect(MIGRATION_SOURCE).toContain(
      `          'price_negotiation_enabled',
            resolved.price_negotiation_enabled`
    );
    // Raw plan fields must not cross the anonymous boundary.
    expect(MIGRATION_SOURCE).not.toContain(
      "'plan_tier', resolved.merchant_data"
    );
    expect(MIGRATION_SOURCE).not.toContain(
      "'plan_tier', merchant_row.merchant_data"
    );
    expect(MIGRATION_SOURCE).toContain('public_feature_setting.key = ANY');
  });
});
