import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903136000_finalize_gigl_wallet_checkout_economics.sql'
  ),
  'utf8'
);

const ownerOnlyReservationMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903137000_enforce_owner_only_wallet_shipping_reservation.sql'
  ),
  'utf8'
);

describe('final GIGL wallet checkout economics migration', () => {
  it('rejects every non-pending account request except an exact fulfilled replay', () => {
    const pendingGuard = migration.indexOf(
      "IF v_request.status IS DISTINCT FROM 'pending' THEN"
    );
    const insert = migration.indexOf(
      'INSERT INTO public.merchant_wallet_payment_accounts'
    );
    expect(pendingGuard).toBeGreaterThan(-1);
    expect(pendingGuard).toBeLessThan(insert);
    expect(migration).toContain("IF v_request.status = 'fulfilled' THEN");
    expect(migration).toContain("'conflicting_assignment_replay'");
  });

  it('checks processing and cancellation state after locking the order', () => {
    const lock = migration.indexOf("'merchant-shipping-order:' || p_order_id");
    const read = migration.indexOf('SELECT * INTO v_order');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(lock);
    expect(migration).toContain(
      "lower(COALESCE(v_order.shipping_status, '')) IS DISTINCT FROM 'processing'"
    );
    expect(migration).toContain('OR v_order.cancelled_at IS NOT NULL THEN');
    expect(migration).toContain('FOR UPDATE;');
  });

  it('backfills still-settleable unsettled legacy GIGL checkout rows', () => {
    expect(migration).toContain('ALTER TABLE public.orders DISABLE TRIGGER');
    expect(migration).toContain("sq.provider = 'GIGL'");
    expect(migration).toContain(
      "o.payment_status NOT IN ('cancelled', 'refunded', 'failed')"
    );
    expect(migration).toContain(
      "lower(COALESCE(o.shipping_status, '')) NOT IN ('cancelled', 'canceled')"
    );
    expect(migration).toContain('o.shipping_funding_source IS DISTINCT FROM');
    expect(migration).toContain(
      'FROM public.merchant_settlements AS settlement'
    );
    expect(migration).toContain(
      "shipping_funding_source = 'customer_checkout'"
    );
    expect(migration).toContain("NEW.shipping_provider := 'GIGL';");
    expect(migration).toContain('shipping_platform_retained_amount = GREATEST');
  });

  it('settles from the immutable order snapshot, never the live quote', () => {
    const settlementStart = migration.indexOf(
      'CREATE OR REPLACE FUNCTION public.record_merchant_settlement_gigl_v1('
    );
    const settlementSql = migration.slice(settlementStart);
    expect(settlementSql).toContain('o.shipping_platform_retained_amount');
    expect(settlementSql).not.toContain('FROM public.shipping_quotes');
    expect(settlementSql).not.toContain('THEN sq.price');
  });

  it('keeps wallet reservation owner-only after the order lock', () => {
    const lock = ownerOnlyReservationMigration.indexOf(
      "'merchant-shipping-order:' || p_order_id"
    );
    const orderRead = ownerOnlyReservationMigration.indexOf(
      'SELECT * INTO v_order'
    );
    const ownerGuard = ownerOnlyReservationMigration.indexOf(
      'FROM public.merchants AS merchant'
    );
    const quoteRead = ownerOnlyReservationMigration.indexOf(
      'FROM public.shipping_quotes'
    );
    const functionEnd = ownerOnlyReservationMigration.indexOf(
      '\n$$;',
      ownerGuard
    );

    expect(lock).toBeGreaterThanOrEqual(0);
    expect(orderRead).toBeGreaterThan(lock);
    expect(ownerGuard).toBeGreaterThan(orderRead);
    expect(ownerGuard).toBeLessThan(quoteRead);
    expect(ownerOnlyReservationMigration).toContain(
      'merchant.user_id = (SELECT auth.uid())'
    );
    expect(
      ownerOnlyReservationMigration.slice(ownerGuard, functionEnd)
    ).not.toContain('check_staff_permission');
  });
});
