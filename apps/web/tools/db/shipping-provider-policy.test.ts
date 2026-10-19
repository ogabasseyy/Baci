import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CARRIER_PROVIDER_IDS } from '@baci/shared/constants';
import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../../..');
const POLICY_MIGRATION_PATH = path.join(
  REPOSITORY_ROOT,
  'supabase/migrations/20260921100200_enforce_merchant_shipping_provider_policy.sql'
);
const SHIPPING_POLICY_SQL_TEST_PATH = path.join(
  REPOSITORY_ROOT,
  'supabase/tests/shipping_provider_settings.sql'
);

function functionDefinition(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `missing ${signature}`).toBeGreaterThanOrEqual(0);

  const end = source.indexOf('$$;', start);
  expect(end, `missing terminator for ${signature}`).toBeGreaterThanOrEqual(0);

  return source.slice(start, end + '$$;'.length);
}

describe('merchant shipping provider policy', () => {
  it('uses an inlineable carrier helper and a single policy check in the order guard', () => {
    expect(existsSync(POLICY_MIGRATION_PATH)).toBe(true);
    if (!existsSync(POLICY_MIGRATION_PATH)) {
      return;
    }

    const migration = readFileSync(POLICY_MIGRATION_PATH, 'utf8');
    const carrierHelper = functionDefinition(
      migration,
      'CREATE OR REPLACE FUNCTION private.supported_carrier_provider_ids()'
    );
    const providerGuard = functionDefinition(
      migration,
      'CREATE OR REPLACE FUNCTION private.enforce_merchant_shipping_provider_enabled()'
    );

    expect(carrierHelper).toContain(
      `SELECT ARRAY[${CARRIER_PROVIDER_IDS.map((id) => `'${id}'`).join(', ')}]::text[];`
    );
    expect(carrierHelper).not.toMatch(/\bSET search_path\b/);
    expect(providerGuard).not.toContain(
      'AND lower(btrim(configured_provider.value)) = ANY ('
    );
    expect(providerGuard).toContain(
      "v_provider IN ('merchant', 'merchant_pickup')"
    );
    expect(providerGuard).toContain("NEW.fulfillment_type = 'self'");
    expect(migration).toContain(
      'CREATE TRIGGER enforce_merchant_shipping_provider_enabled'
    );
  });

  it('keeps the SQL runtime check aligned with the shared carrier catalog', () => {
    const sqlTest = readFileSync(SHIPPING_POLICY_SQL_TEST_PATH, 'utf8');

    expect(sqlTest).toContain(
      `ARRAY[${CARRIER_PROVIDER_IDS.map((id) => `'${id}'`).join(', ')}]`
    );
  });

  it('covers changed selections after opt-out and mixed-case stored carrier settings', () => {
    const sqlTest = readFileSync(SHIPPING_POLICY_SQL_TEST_PATH, 'utf8');

    expect(sqlTest).toContain(
      'changing a carrier selection after opt-out must be rejected'
    );
    expect(sqlTest).toContain(
      'mixed-case stored carrier settings must authorize a new selection'
    );
    expect(sqlTest).toContain(
      'merchant and self-fulfillment provider stamps must remain allowed'
    );
  });
});
