import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260805150400_admin_merchant_360.sql'
  ),
  'utf8'
);
const processingSettlementRepairMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260805151511_repair_admin_merchant_360_processing_settlements.sql'
  ),
  'utf8'
);

describe('admin merchant 360 migration contract', () => {
  it('uses the RBAC bridge for one platform-admin-gated security-definer read model', () => {
    expect(migration).toMatch(
      /FUNCTION public\.get_admin_merchant_360\(\s*p_merchant_id uuid\s*\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/i
    );
    expect(migration).toMatch(/platform_admin_required/i);
    expect(migration).toContain('private.has_platform_admin_permission_v1');
    expect(migration).toContain("'merchants.read'");
    expect(migration).not.toMatch(/admin_merchant\.is_platform_admin/i);
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_admin_merchant_360\(uuid\)\s+TO authenticated;/i
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_admin_merchant_360\(uuid\)\s+FROM PUBLIC, anon, authenticated, service_role;/i
    );
  });

  it('does not filter unpublished merchants or cap authenticated customer counts at 100', () => {
    expect(migration).toContain('WHERE merchant.id = p_merchant_id');
    expect(migration).not.toMatch(/merchant\.is_published\s+IS\s+TRUE/i);
    expect(migration).toMatch(
      /count\(DISTINCT identity\.user_id\) FILTER \(WHERE identity\.kind = 'customer'\)::bigint AS customer_users/i
    );
    expect(migration).toContain('WHERE identity.user_id IS NOT NULL');
    expect(migration).not.toMatch(/LIMIT\s+100/i);
  });

  it('does not return people, credentials, bank values, customer records, or raw errors', () => {
    expect(migration).not.toMatch(/'email'\s*,/i);
    expect(migration).not.toMatch(/'phone'\s*,/i);
    expect(migration).not.toMatch(/'userId'\s*,/i);
    expect(migration).not.toMatch(/'directory'\s*,/i);
    expect(migration).not.toMatch(/'paystackSubaccountCode'\s*,/i);
    expect(migration).not.toMatch(/bank_account_number/i);
    expect(migration).not.toMatch(/ciphertext/i);
    expect(migration).not.toMatch(/last_validation_error/i);
    expect(migration).not.toMatch(/error_message/i);
    expect(migration).not.toMatch(/'customers'\s*,\s*pg_catalog\.jsonb/i);
  });

  it('uses verified primary-domain and actual shipping-rate readiness', () => {
    expect(migration).toContain(
      'WHERE d.merchant_id = v_merchant.id AND d.is_primary IS TRUE'
    );
    expect(migration).toContain('primary_domain.verified_at IS NOT NULL');
    expect(migration).toContain("primary_domain.status = 'active'");
    expect(migration).toContain("primary_domain.ssl_status = 'active'");
    const shippingConfiguration = migration.match(
      /CROSS JOIN LATERAL \([\s\S]*?\) AS shipping_configuration/i
    )?.[0];
    expect(shippingConfiguration).toContain(
      'public.merchant_shipping_rates AS shipping_rate'
    );
    expect(shippingConfiguration).toContain(
      'public.merchant_shipping_zones AS shipping_zone'
    );
    expect(shippingConfiguration).toContain('shipping_rate.active IS TRUE');
    expect(shippingConfiguration).toContain('shipping_zone.active IS TRUE');
    expect(shippingConfiguration).not.toContain('shipping_providers');
  });

  it('does not treat the default Paystack feature flag as configured payments', () => {
    expect(migration).toContain('merchant.paystack_subaccount_code');
    expect(migration).toContain(
      "NULLIF(BTRIM(v_merchant.paystack_subaccount_code), '') IS NOT NULL"
    );
    expect(migration).toContain('feature_settings.pay_on_delivery_enabled');
  });

  it('uses the active currency-scoped payout lane', () => {
    expect(migration).toContain("'moneyCurrency'");
    expect(migration).toContain('FROM public.payout_requests AS payout');
    expect(migration).not.toContain('FROM public.payouts AS payout');
    expect(migration).toContain(
      'FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_admin_merchant_profiles\(\)[\s\S]*?TO service_role;/i
    );
  });

  it('never selects an entire merchant row into the definer function', () => {
    expect(migration).not.toMatch(/SELECT\s+merchant\.\*/i);
  });

  it('counts processing settlements as pending merchant funds', () => {
    expect(processingSettlementRepairMigration).toContain(
      "settlement.status IN ('pending', 'processing')"
    );
    expect(processingSettlementRepairMigration).toContain(
      'FUNCTION public.get_admin_merchant_360_v2'
    );
    expect(processingSettlementRepairMigration).toContain('SECURITY DEFINER');
  });
});
