import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const baselineMigration = readFileSync(
  resolve(
    currentDir,
    '../../../../../supabase/migrations/20260418000000_baseline.sql'
  ),
  'utf8'
);
const quoteScopeMigration = readFileSync(
  resolve(
    currentDir,
    '../../../../../supabase/migrations/20260707015215_scope_shipping_quotes_to_merchant.sql'
  ),
  'utf8'
);
const bookingLockRepairMigration = readFileSync(
  resolve(
    currentDir,
    '../../../../../supabase/migrations/20260730223000_fix_order_shipment_booking_lock_ambiguity.sql'
  ),
  'utf8'
);
const bookingLockTimeoutRepairMigration = readFileSync(
  resolve(
    currentDir,
    '../../../../../supabase/migrations/20260803000400_restore_booking_lock_timeout_floor.sql'
  ),
  'utf8'
);
const shipmentQuoteRecoveryMigration = readFileSync(
  resolve(
    currentDir,
    '../../../../../supabase/migrations/20260825154500_persist_shipment_shipping_quote.sql'
  ),
  'utf8'
);

function tableDefinition(tableName: string): string {
  const start = baselineMigration.indexOf(
    `CREATE TABLE IF NOT EXISTS "public"."${tableName}" (`
  );
  const end = baselineMigration.indexOf(');', start);

  if (start === -1 || end === -1) {
    throw new Error(`Missing ${tableName} table in baseline migration`);
  }

  return baselineMigration.slice(start, end);
}

describe('shipping database contract', () => {
  it('uses station_name and station_address columns for station pickup persistence', () => {
    const shipments = tableDefinition('shipments');
    const shippingQuotes = tableDefinition('shipping_quotes');

    for (const table of [shipments, shippingQuotes]) {
      expect(table).toContain('"is_station_pickup" boolean DEFAULT false');
      expect(table).toContain('"station_name" "text"');
      expect(table).toContain('"station_address" "text"');
      expect(table).not.toContain('"pickup_station_name"');
      expect(table).not.toContain('"pickup_station_address"');
    }
  });

  it('scopes cached shipping quotes to merchants without public table access', () => {
    expect(quoteScopeMigration).toContain(
      'ADD COLUMN IF NOT EXISTS merchant_id uuid'
    );
    expect(quoteScopeMigration).toMatch(
      /UPDATE\s+public\.shipping_quotes\s+sq\s+SET\s+merchant_id\s+=\s+o\.merchant_id\s+FROM\s+public\.orders\s+o/i
    );
    expect(quoteScopeMigration).toContain(
      'DROP POLICY IF EXISTS "Public can read quotes"'
    );
    expect(quoteScopeMigration).toContain(
      'DROP POLICY IF EXISTS "Public can create quotes"'
    );
    expect(quoteScopeMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.shipping_quotes\s+FROM\s+anon/i
    );
    expect(quoteScopeMigration).toMatch(
      /public\.has_merchant_access\(merchant_id\)/
    );
    expect(quoteScopeMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.get_checkout_shipping_quote'
    );
    expect(quoteScopeMigration).toContain("sq.quote_request - 'sender'");
    expect(quoteScopeMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_checkout_shipping_quote\(uuid,\s*uuid\)\s+TO\s+anon,\s+authenticated,\s+service_role/i
    );
  });

  it('qualifies shipment booking lock columns that collide with RPC outputs', () => {
    expect(bookingLockRepairMigration).toContain(
      'UPDATE public.orders AS target'
    );
    expect(bookingLockRepairMigration).toContain(
      'AND target.shipment_id IS NULL'
    );
    expect(bookingLockRepairMigration).toContain(
      'AND target.tracking_number IS NULL'
    );
    expect(bookingLockRepairMigration).toContain(
      'target.shipment_booking_lock_token IS NULL'
    );
  });

  it('keeps direct booking-lock claims behind the minimum timeout floor', () => {
    expect(bookingLockTimeoutRepairMigration).toContain(
      'greatest(coalesce(p_lock_timeout_seconds, 900), 900)'
    );
    expect(bookingLockTimeoutRepairMigration).toContain(
      'pg_catalog.make_interval'
    );
  });

  it('persists the effective shipping quote used by a booked shipment', () => {
    expect(shipmentQuoteRecoveryMigration).toContain(
      'ADD COLUMN IF NOT EXISTS shipping_quote_id uuid'
    );
    expect(shipmentQuoteRecoveryMigration).toContain(
      'ADD CONSTRAINT shipments_shipping_quote_id_fkey'
    );
    expect(shipmentQuoteRecoveryMigration).toContain(
      'CREATE INDEX IF NOT EXISTS idx_shipments_shipping_quote_id'
    );
  });
});
