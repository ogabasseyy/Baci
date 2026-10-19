import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260902103000_sanitize_shipping_quote_booking_metadata.sql'
);
const directBookingMigrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260902104500_allow_direct_quote_metadata_lookup.sql'
);

describe('GIGL quote economics access migration', () => {
  it('removes the table-wide authenticated read grant', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(
      /REVOKE\s+SELECT\s+ON\s+TABLE\s+public\.shipping_quotes\s+FROM\s+authenticated/i
    );
    expect(sql).toMatch(
      /REVOKE\s+UPDATE\s+ON\s+TABLE\s+public\.shipping_quotes\s+FROM\s+authenticated/i
    );
    expect(sql).toMatch(
      /REVOKE\s+INSERT\s+ON\s+TABLE\s+public\.shipping_quotes\s+FROM\s+authenticated/i
    );
    expect(sql).toMatch(
      /REVOKE\s+INSERT\s*\([^)]*provider_metadata[^)]*\)\s+ON\s+TABLE\s+public\.shipping_quotes\s+FROM\s+authenticated/i
    );
    expect(sql).toMatch(
      /REVOKE\s+UPDATE\s*\([^)]*provider_metadata[^)]*\)\s+ON\s+TABLE\s+public\.shipping_quotes\s+FROM\s+authenticated/i
    );
    expect(sql).toMatch(/GRANT\s+UPDATE\s*\(used\)/i);
  });

  it('grants authenticated clients only the non-economic quote projection', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const grant = sql.match(
      /GRANT\s+SELECT\s*\((?<columns>[\s\S]*?)\)\s+ON\s+TABLE\s+public\.shipping_quotes\s+TO\s+authenticated/i
    )?.groups?.columns;

    expect(grant).toBeDefined();
    expect(grant).not.toMatch(
      /provider_cost|platform_margin|platform_margin_bps|pricing_version/i
    );
    expect(grant).toMatch(/provider_rate_id/);
    expect(grant).toMatch(/quote_request/);
    expect(grant).not.toMatch(/provider_metadata/);
    expect(sql).toMatch(/GRANT\s+UPDATE\s*\(used\)/i);
    expect(sql).not.toMatch(/GRANT\s+UPDATE\s*\([^)]*price/i);
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_shipping_quote_booking_metadata\(/i
    );
    expect(sql).toMatch(/check_staff_permission\(/);
    expect(sql).toMatch(/sq\.provider\s*=\s*'TOPSHIP'/i);
    expect(sql).toMatch(/'pricingTier'/);
    expect(sql).toMatch(/'serviceType'/);
    expect(sql).toMatch(/'cost'/);
    expect(sql).toMatch(/ELSE\s+NULL/i);
    expect(sql).not.toMatch(
      /(?<!')\b(?:[a-z_][\w]*\.)?provider_metadata\b(?!\s*(?:->|->>|\)))/i
    );
  });

  it('allows an exact merchant quote lookup before selected_quote_id is persisted', () => {
    const sql = readFileSync(directBookingMigrationPath, 'utf8');

    expect(sql).toMatch(
      /o\.selected_quote_id\s*=\s*sq\.id\s+OR\s+o\.selected_quote_id\s+IS\s+NULL/i
    );
    expect(sql).toMatch(/sq\.id\s*=\s*p_quote_id/i);
    expect(sql).toMatch(/sq\.merchant_id\s*=\s*p_merchant_id/i);
    expect(sql).toMatch(/public\.check_staff_permission\(/i);
    expect(sql).not.toMatch(/GRANT\s+EXECUTE[^;]*anon/i);
  });
});
