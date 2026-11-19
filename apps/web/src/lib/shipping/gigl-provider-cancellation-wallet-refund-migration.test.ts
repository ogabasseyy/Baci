import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationFiles = [
  '20261102053300_stamp_gigl_wallet_charge_waybill.sql',
  '20261102053310_add_gigl_provider_cancellation_refund_helper.sql',
  '20261102053320_refund_gigl_wallet_charge_on_provider_cancellation.sql',
] as const;
const sources = migrationFiles.map((file) =>
  readFileSync(
    resolve(process.cwd(), '../../supabase/migrations', file),
    'utf8'
  )
);
const [stampCode, helperCode, patchCode] = sources.map((sql) =>
  sql.replace(/--.*$/gm, '')
) as [string, string, string];
const allCode = `${stampCode}\n${helperCode}\n${patchCode}`;

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) {
    throw new Error(`Missing section starting with ${start}`);
  }
  return source.slice(from, to);
}

const helper = sliceBetween(
  helperCode,
  'CREATE FUNCTION private.refund_gigl_wallet_charge_on_provider_cancellation(',
  '$$;'
);
const stamp = sliceBetween(
  stampCode,
  'CREATE FUNCTION private.stamp_booked_gigl_charge_waybill()',
  '$$;'
);
const patch = sliceBetween(patchCode, 'DO $migration$', '$migration$;');
const asserts = sliceBetween(patchCode, 'DO $assert$', '$assert$;');
const replacement = sliceBetween(
  patch,
  'v_replacement constant text :=',
  '  v_original text;'
);
const backfill = sliceBetween(
  stampCode,
  'WITH candidate AS (',
  'CREATE UNIQUE INDEX wallet_transactions_gigl_charge_refund_once_idx'
);

describe('bugfix: GIG cancellation of a wallet-funded GIGL booking', () => {
  it('splits into ordered gigl migrations of at most 300 lines each', () => {
    const versions = migrationFiles.map((file) => file.slice(0, 14));
    expect([...versions].sort()).toEqual(versions);
    expect(new Set(versions).size).toBe(versions.length);
    migrationFiles.forEach((file, index) => {
      expect(file).toContain('gigl');
      expect(sources[index]?.split('\n').length).toBeLessThanOrEqual(300);
    });
  });

  it('patches the live apply function in place before its shipments update', () => {
    expect(allCode).not.toContain(
      'CREATE OR REPLACE FUNCTION public.apply_gigl_tracking_result'
    );
    expect(patch).toContain('pg_catalog.pg_get_functiondef(v_fn)');
    expect(patch).toContain(
      "E'  SELECT count(*) INTO v_inserted_events FROM inserted_events;\\n'\n    || E'  UPDATE public.shipments AS shipment\\n'"
    );
    expect(patch).toContain('anchor must occur exactly once');
    expect(patch).toContain('already refunds provider cancellations');
    expect(patch).toContain('must precede the shipments update');
    expect(replacement).toContain(
      "'      p_shipment_id, p_tracking_epoch_id, v_order_id, v_current_status,\\n'\n    || E'      p_events\\n'"
    );
    expect(asserts).toContain('must pass p_events to the refund helper');
  });

  it('orders the replacement text: guarded refund call, then the shipments update', () => {
    const shipmentsUpdateLine = "E'  UPDATE public.shipments AS shipment\\n'";
    const guardedCall = replacement.indexOf(
      "IF v_effective_status = ''cancelled'' AND p_status = ''cancelled'' THEN"
    );
    const helperCall = replacement.indexOf(
      'PERFORM private.refund_gigl_wallet_charge_on_provider_cancellation('
    );
    const shipmentsUpdate = replacement.indexOf(shipmentsUpdateLine);
    expect(guardedCall).toBeGreaterThan(0);
    expect(helperCall).toBeGreaterThan(guardedCall);
    expect(shipmentsUpdate).toBeGreaterThan(helperCall);
    expect(replacement.lastIndexOf(shipmentsUpdateLine)).toBe(shipmentsUpdate);
  });

  it('leaves the merchant cancellation guard untouched', () => {
    expect(allCode).not.toContain(
      'FUNCTION private.prevent_active_gigl_shipping_cancellation'
    );
  });

  it('keeps the refund helper and the stamp trigger private to the database', () => {
    for (const body of [helper, stamp]) {
      expect(body).toContain('SECURITY DEFINER');
      expect(body).toContain("SET search_path TO ''");
    }
    expect(helperCode).toContain(
      'REVOKE ALL ON FUNCTION private.refund_gigl_wallet_charge_on_provider_cancellation(uuid, uuid, uuid, text, jsonb)\n  FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(stampCode).toContain(
      'REVOKE ALL ON FUNCTION private.stamp_booked_gigl_charge_waybill()\n  FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(allCode).not.toMatch(/GRANT\s+EXECUTE/i);
    expect(helper).toContain(
      "IF auth.role() IS DISTINCT FROM 'service_role' THEN"
    );
    expect(helper).toContain('AND monitor.locked_by IS NOT NULL');
    expect(asserts).toContain(
      'the unattested provider-cancellation helper must not exist'
    );
  });

  it('refunds only cancellations GIG reports before pickup', () => {
    const allowlist = helper.indexOf(
      "p_prior_shipment_status NOT IN ('pending', 'booked', 'pickup_scheduled')"
    );
    expect(allowlist).toBeGreaterThan(0);
    expect(helper.indexOf('RETURN 0;', allowlist)).toBeGreaterThan(allowlist);
    expect(helper.indexOf('pg_advisory_xact_lock')).toBeGreaterThan(allowlist);
    expect(
      helper.indexOf('INSERT INTO public.wallet_transactions')
    ).toBeGreaterThan(allowlist);
  });

  it("judges pickup from GIG's recorded events, not only the merchant-writable status", () => {
    const pickup = helper.indexOf(
      "OR history.normalized_status NOT IN (\n            'pending', 'booked', 'pickup_scheduled', 'cancelled'\n          )"
    );
    expect(pickup).toBeGreaterThan(0);
    expect(helper).toContain('FROM public.shipment_tracking_events AS history');
    expect(helper).toContain(
      'AND history.tracking_number = v_charge.provider_reference'
    );
    expect(helper).not.toContain('history.tracking_epoch_id');
    expect(
      helper.indexOf('INSERT INTO public.wallet_transactions')
    ).toBeGreaterThan(pickup);
  });

  it("bugfix: treats an unmapped GIG scan stored as 'pending' as post-pickup", () => {
    expect(helper).toContain(
      "history.normalized_status = 'pending'\n            AND upper(btrim(coalesce(history.raw_status, ''))) <> 'PENDING'"
    );
  });

  it("requires GIG's timeline to show the waybill was created by this charge's submission", () => {
    expect(helper).toContain(
      "v_clock_skew constant interval := interval '5 minutes';"
    );
    expect(helper).toContain(
      "v_submission_window constant interval := interval '15 minutes';"
    );
    const submitted = helper.indexOf(
      'CONTINUE WHEN v_charge.provider_submitting_at IS NULL;'
    );
    const created = helper.indexOf('SELECT max(created.occurred_at)');
    const earlier = helper.indexOf(
      'history.occurred_at < v_charge.provider_submitting_at - v_clock_skew'
    );
    const afterCreation = helper.indexOf(
      'AND event.occurred_at >= v_created_at'
    );
    const credit = helper.indexOf('INSERT INTO public.wallet_transactions');
    expect(submitted).toBeGreaterThan(0);
    expect(created).toBeGreaterThan(submitted);
    expect(helper).toContain('CONTINUE WHEN v_created_at IS NULL;');
    expect(helper).toContain(
      '<= v_charge.provider_submitting_at + v_submission_window'
    );
    expect(earlier).toBeGreaterThan(created);
    expect(afterCreation).toBeGreaterThan(earlier);
    expect(credit).toBeGreaterThan(afterCreation);
    expect(helper).not.toContain('completed_at');
  });

  it("bugfix: requires the worker's account attestation on the chosen cancellation in this apply call", () => {
    expect(helper).toContain(
      "IF jsonb_typeof(p_events) IS DISTINCT FROM 'array' THEN"
    );
    expect(helper).toContain(
      "WHERE attested.entry ->> 'provider_event_key' = event.provider_event_key"
    );
    expect(helper).toContain(
      "AND attested.entry -> 'account_attested' = 'true'::jsonb"
    );
    expect(helper).toContain("'provider_account_attested', true");
  });

  it('bugfix: declines a mismatched debit or a missing wallet instead of raising P0001', () => {
    expect(helper).not.toContain(
      "RAISE EXCEPTION 'gigl_wallet_charge_debit_mismatch'"
    );
    expect(helper).not.toContain("RAISE EXCEPTION 'merchant_wallet_missing'");
    expect(helper).toContain('AND debit.amount = v_charge.charged_amount');
    const wallet = helper.indexOf('UPDATE public.merchant_wallets AS wallet');
    expect(helper.indexOf('CONTINUE WHEN NOT FOUND;', wallet)).toBeGreaterThan(
      wallet
    );
  });

  it('refunds a booked charge once, only on cancellation evidence for its own waybill', () => {
    expect(helper).toContain("AND charge.status = 'booked'");
    expect(helper).toContain('FOR UPDATE OF charge');
    expect(helper).toContain("AND event.normalized_status = 'cancelled'");
    expect(helper).toContain(
      'AND event.tracking_epoch_id = p_tracking_epoch_id'
    );
    expect(helper).toContain(
      'AND event.tracking_number = v_charge.provider_reference'
    );
    const refundUpdate = helper.indexOf("SET status = 'refunded'");
    const rowCount = helper.indexOf('GET DIAGNOSTICS v_rows = ROW_COUNT;');
    expect(refundUpdate).toBeGreaterThan(0);
    expect(
      helper.indexOf("AND charge.status = 'booked';", refundUpdate)
    ).toBeGreaterThan(refundUpdate);
    expect(rowCount).toBeGreaterThan(refundUpdate);
    expect(helper).toContain("'merchant_shipping_charge_id', v_charge.id");
  });

  it("bugfix: stamps only the server's own complete() on its untouched shipment row", () => {
    expect(stampCode).toContain(
      'CREATE TRIGGER stamp_booked_gigl_charge_waybill\nBEFORE UPDATE OF status ON public.merchant_shipping_charges'
    );
    expect(stamp).toContain("IF NEW.status = 'booked'");
    expect(stamp).toContain("AND OLD.status = 'provider_submitting'");
    expect(stamp).toContain(
      'AND NEW.attempt_token_digest IS NOT DISTINCT FROM OLD.attempt_token_digest'
    );
    expect(stamp).toContain('AND shipment.tracking_snapshot_version = 1;');
    expect(stamp).toContain('AND NEW.provider_reference IS NULL');
    expect(stampCode).toContain(
      'CREATE UNIQUE INDEX wallet_transactions_gigl_charge_refund_once_idx'
    );
    expect(stampCode).toContain("AND source_type = 'gigl_shipping'");
  });

  it('lets one waybill back at most one booked or refunded charge', () => {
    expect(stampCode).toContain(
      "CREATE UNIQUE INDEX merchant_shipping_charges_gigl_waybill_once_idx\n  ON public.merchant_shipping_charges (provider_reference)\n  WHERE provider_reference IS NOT NULL\n    AND status IN ('booked', 'refunded');"
    );
    const lock = stamp.indexOf(
      "hashtextextended('gigl-charge-waybill:' || v_waybill, 0)"
    );
    const taken = stamp.indexOf("AND other.status IN ('booked', 'refunded')");
    const assign = stamp.indexOf('NEW.provider_reference := v_waybill;');
    expect(lock).toBeGreaterThan(0);
    expect(taken).toBeGreaterThan(lock);
    expect(assign).toBeGreaterThan(taken);
    expect(stamp).not.toContain('RAISE');
  });

  it('backfills only a charge the server completed right after inserting its shipment', () => {
    expect(backfill).toContain("AND created.normalized_status = 'booked'");
    expect(backfill).toContain(
      "<= charge.provider_submitting_at + interval '15 minutes'"
    );
    expect(backfill).toContain(
      "< charge.provider_submitting_at - interval '5 minutes'"
    );
    expect(backfill).toContain(
      "AND charge.completed_at <= shipment.created_at + interval '1 minute'"
    );
    expect(backfill).toContain('FROM candidate AS twin');
    expect(backfill).toContain("AND other.status IN ('booked', 'refunded')");
    // bugfix: the backfill runs before the unique index, serialized per
    // waybill with the stamp trigger's advisory lock and row locks.
    const loop = sliceBetween(stampCode, 'DO $backfill$', '$backfill$;');
    expect(loop).toContain(
      "hashtextextended('gigl-charge-waybill:' || v_row.waybill, 0)"
    );
    expect(loop).toContain('FOR UPDATE;');
    expect(loop.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      loop.indexOf('FOR UPDATE;')
    );
    expect(loop.indexOf('FOR UPDATE;')).toBeLessThan(
      loop.indexOf('SET provider_reference = v_row.waybill')
    );
    expect(stampCode.indexOf('DO $backfill$')).toBeLessThan(
      stampCode.indexOf(
        'CREATE UNIQUE INDEX merchant_shipping_charges_gigl_waybill_once_idx'
      )
    );
  });
});
