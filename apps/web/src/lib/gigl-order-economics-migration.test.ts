import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260901191000_stamp_gigl_order_economics.sql'
  ),
  'utf8'
);

describe('GIGL order economics migration contract', () => {
  it('adds the nullable snapshot columns and constrained funding source', () => {
    for (const column of [
      'shipping_funding_source',
      'shipping_provider_cost',
      'shipping_platform_margin',
      'shipping_platform_retained_amount',
      'shipping_pricing_version',
    ]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(migration).toContain("IN ('customer_checkout', 'merchant_wallet')");
  });

  it('stamps only matching newly priced GIGL quotes and preserves legacy nulls', () => {
    expect(migration).toContain(
      "v_pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'"
    );
    expect(migration).toContain(
      "upper(pg_catalog.btrim(COALESCE(v_provider, ''))) <> 'GIGL'"
    );
    expect(migration).toContain('sq.merchant_id = NEW.merchant_id');
    expect(migration).toContain(
      "NEW.shipping_funding_source := 'customer_checkout'"
    );
    expect(migration).toContain(
      "WHEN NEW.shipping_funding_source = 'customer_checkout' THEN v_price"
    );
  });

  it('makes merchant wallet authoritative and does not mutate order totals', () => {
    expect(migration).toContain('NEW.shipping_platform_retained_amount := 0');
    expect(migration).toContain('ELSE 0');
    expect(migration).not.toMatch(/NEW\.(shipping_fee|subtotal|total)\s*:=/);
    expect(migration).toMatch(
      /BEFORE INSERT OR UPDATE OF selected_quote_id,\s*shipping_funding_source,\s*shipping_provider_cost,\s*shipping_platform_margin,\s*shipping_platform_retained_amount,\s*shipping_pricing_version/
    );
  });

  it('restamps every customer-checkout economics field from the quote', () => {
    expect(migration).toContain(
      'NEW.shipping_provider_cost := v_provider_cost;'
    );
    expect(migration).toContain(
      'NEW.shipping_platform_margin := v_platform_margin;'
    );
    expect(migration).toContain(
      'NEW.shipping_pricing_version := v_pricing_version;'
    );
    expect(migration).toContain(
      "WHEN NEW.shipping_funding_source = 'customer_checkout' THEN v_price"
    );
    expect(migration).toContain('ELSE 0');
  });

  it('clears forged source and economics when there is no authoritative quote', () => {
    const clearAssignments = [
      'NEW.shipping_funding_source := NULL;',
      'NEW.shipping_provider_cost := NULL;',
      'NEW.shipping_platform_margin := NULL;',
      'NEW.shipping_pricing_version := NULL;',
      'NEW.shipping_platform_retained_amount := 0;',
    ];
    const noQuoteBranch = migration.slice(
      migration.indexOf('IF NEW.selected_quote_id IS NULL THEN'),
      migration.indexOf('SELECT sq.provider')
    );
    for (const assignment of clearAssignments) {
      expect(noQuoteBranch).toContain(assignment);
    }
  });

  it.each([
    'IF NEW.selected_quote_id IS NULL THEN',
    'IF NOT FOUND OR',
    "upper(pg_catalog.btrim(COALESCE(v_provider, ''))) <> 'GIGL'",
    "v_pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'",
  ])('clears caller-supplied economics before ineligible return (%s)', (marker) => {
    expect(migration).toContain(marker);
    expect(migration).toContain('NEW.shipping_funding_source := NULL');
    expect(migration).toContain('NEW.shipping_provider_cost := NULL');
    expect(migration).toContain('NEW.shipping_platform_margin := NULL');
    expect(migration).toContain('NEW.shipping_pricing_version := NULL');
    expect(migration).toContain('NEW.shipping_platform_retained_amount := 0');
  });
});
