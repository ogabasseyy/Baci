import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AIRPORT_DELIVERY_FEES } from '@baci/shared/constants';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260827140000_enforce_storefront_order_delivery_metadata.sql'
  ),
  'utf8'
);
const columnPreparationMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828150000_prepare_storefront_order_delivery_columns.sql'
  ),
  'utf8'
);
const pickupLocationMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828151000_enforce_storefront_airport_pickup_location.sql'
  ),
  'utf8'
);
const quizReservedOrderMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828160000_persist_quiz_reserved_order_delivery_metadata.sql'
  ),
  'utf8'
);
const quizReservedOrderValidationScopeMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828160200_limit_quiz_reserved_order_delivery_validation_to_redemption.sql'
  ),
  'utf8'
);

describe('storefront order delivery metadata migration contract', () => {
  it('persists a durable delivery discriminator with airport invariants', () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS delivery_method text'
    );
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS airport_type text');
    expect(migration).toContain('orders_delivery_method_check');
    expect(migration).toContain('orders_airport_type_method_check');
    expect(migration).toContain(
      "airport_type IS NULL OR delivery_method = 'airport'"
    );
  });

  it('installs delivery columns before the deferred enforcement migration', () => {
    expect(columnPreparationMigration).toContain(
      'ADD COLUMN IF NOT EXISTS delivery_method text'
    );
    expect(columnPreparationMigration).toContain(
      'ADD COLUMN IF NOT EXISTS airport_type text'
    );
    expect(columnPreparationMigration).not.toContain('CREATE TRIGGER');
    expect(pickupLocationMigration).toContain(
      'Airport pickup location is required'
    );
    expect(pickupLocationMigration).toContain(
      "pg_catalog.lower(v_city) = 'airport'"
    );
  });

  it('enforces fixed airport fees without treating fee amounts as a discriminator', () => {
    expect(AIRPORT_DELIVERY_FEES.delivery).toBe(35_000);
    expect(AIRPORT_DELIVERY_FEES.pickup).toBe(20_000);
    expect(migration).toContain("WHEN 'delivery' THEN 35000::numeric");
    expect(migration).toContain("WHEN 'pickup' THEN 20000::numeric");
    expect(migration).toContain(
      `WHEN 'delivery' THEN ${AIRPORT_DELIVERY_FEES.delivery}::numeric`
    );
    expect(migration).toContain(
      `WHEN 'pickup' THEN ${AIRPORT_DELIVERY_FEES.pickup}::numeric`
    );
    expect(migration).toContain("'airport delivery'");
    expect(migration).toContain("'airport pickup'");
    expect(migration).not.toContain('shipping_fee = 25000');
  });

  it('validates provider-backed airport quotes at the insert boundary', () => {
    expect(migration).toContain('sq.merchant_id = NEW.merchant_id');
    expect(migration).toContain("split_part(v_quote_rate_id, '_', 3) <> '0'");
    expect(migration).toContain("split_part(v_quote_rate_id, '_', 6) <> '1'");
    expect(migration).toContain("LIKE '%gofaster%'");
    expect(migration).toContain('NEW.shipping_fee - v_quote_price');
    expect(migration).toContain('v_quote_expires_at <= pg_catalog.now()');
  });

  it('removes transport-only metadata before storing ad tracking', () => {
    expect(migration).toContain("'__baci_delivery_method'");
    expect(migration).toContain("'__baci_airport_type'");
    expect(migration).toContain('NEW.ad_tracking := NEW.ad_tracking');
  });

  it('persists and validates metadata when a serialized quiz order is redeemed', () => {
    expect(quizReservedOrderMigration).toContain(
      'ad_tracking = COALESCE(p_ad_tracking, ad_tracking)'
    );
    expect(quizReservedOrderMigration).toContain(
      'validate_quiz_reserved_order_delivery_metadata'
    );
    expect(quizReservedOrderMigration).toContain(
      "OLD.source = 'quiz_prize' AND OLD.payment_method = 'quiz_award'"
    );
    expect(quizReservedOrderMigration).toContain(
      'validate_quiz_reserved_order_airport_pickup_location'
    );
  });

  it('does not revalidate redeemed quiz orders during later fulfillment updates', () => {
    expect(quizReservedOrderValidationScopeMigration).toContain(
      "NEW.ad_tracking ? '__baci_delivery_method'"
    );
    expect(quizReservedOrderValidationScopeMigration).toContain(
      "NEW.ad_tracking ? '__baci_airport_type'"
    );
    expect(quizReservedOrderValidationScopeMigration).toContain(
      'validate_quiz_reserved_order_delivery_metadata'
    );
    expect(quizReservedOrderValidationScopeMigration).toContain(
      'validate_quiz_reserved_order_airport_pickup_location'
    );
  });
});
