import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGiglExternalWaybillLinkTestDatabase } from '../../../../../supabase/tests/gigl-external-waybill-link-test-harness.mjs';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

import {
  actor,
  asPostgres,
  link,
  merchantId,
  order,
  otherMerchantId,
  otherOwnerId,
  ownerId,
  proof,
  staff,
  staffId,
} from './gigl-external-waybill-link.postgres.test-support';

// Dedicated DB CI invokes this explicitly with BACI_SHIPPING_QUOTE_POSTGRES=1.
describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'external GIG waybill link PostgreSQL boundary',
  () => {
    const database = createGiglExternalWaybillLinkTestDatabase();
    beforeAll(() => database.start(), 90000);
    afterAll(() => database.stop());
    const run = (sql: string) =>
      database.query(`BEGIN; ${sql} ROLLBACK;`).trim().split('\n');
    const last = (sql: string) => run(sql).at(-1);

    it('lets authenticated callers run the proof-gated RPC but not write funding_source', () => {
      const signature = 'public.link_external_gigl_waybill(uuid,jsonb)';
      expect(
        last(`SELECT has_function_privilege('authenticated','${signature}','EXECUTE'),
          has_function_privilege('anon','${signature}','EXECUTE'),
          EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL
            pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
            WHERE p.oid='${signature}'::regprocedure AND a.grantee=0),
          has_column_privilege('authenticated','public.shipments','funding_source','INSERT'),
          has_column_privilege('authenticated','public.shipments','funding_source','UPDATE'),
          has_column_privilege('authenticated','public.shipments','funding_source','SELECT');`)
      ).toBe('t|f|f|f|f|t');
    });

    it('creates an external shipment and points the order at it', () => {
      const row = last(`${actor(ownerId)} ${link(order('a'))} ${asPostgres}
        SELECT s.provider, s.provider_shipment_id, s.tracking_number, s.status,
          s.funding_source, s.price, s.is_station_pickup, s.shipping_quote_id IS NULL,
          s.provider_cost IS NULL, s.receiver_address->>'state',
          o.shipment_id = s.id, o.tracking_number, o.shipping_status,
          o.shipping_provider, o.fulfillment_type
        FROM public.shipments s JOIN public.orders o ON o.id = s.order_id
        WHERE s.order_id = '${order('a')}';`);
      expect(row).toBe(
        'GIGL|2000000001|2000000001|booked|external_manual|45852.2|t|t|t|EBONYI|t|2000000001|shipped|GIGL|provider'
      );
    });

    it('clears an unused Baci wallet quote when linking', () => {
      const row =
        last(`${actor(ownerId)} ${link(order('3'), proof(order('3'), '2000000003'))}
        ${asPostgres}
        SELECT selected_quote_id IS NULL, shipping_funding_source IS NULL,
          shipping_provider_cost IS NULL, shipping_platform_retained_amount
        FROM public.orders WHERE id = '${order('3')}';`);
      expect(row).toBe('t|t|t|0');
    });

    it('replaces rider details on an order that was self-fulfilled', () => {
      const row =
        last(`${actor(ownerId)} ${link(order('e'), proof(order('e'), '2000000005'))}
        ${asPostgres}
        SELECT shipping_status, fulfillment_type, self_fulfillment_data IS NULL,
          shipment_id IS NOT NULL
        FROM public.orders WHERE id = '${order('e')}';`);
      expect(row).toBe('shipped|provider|t|t');
    });

    it('lets orders.fulfill staff link but not staff who can only view orders', () => {
      expect(
        last(
          `${staff({ orders: { view: true, fulfill: true } })} ${actor(staffId)} ${link(order('a'))}`
        )
      ).toBe('t');
      expect(() =>
        run(
          `${staff({ orders: { view: true } })} ${actor(staffId)} ${link(order('a'))}`
        )
      ).toThrow(/order_not_owned/);
    });

    it('rejects another merchant', () => {
      expect(() => run(`${actor(otherOwnerId)} ${link(order('a'))}`)).toThrow(
        /order_not_owned/
      );
    });

    it('never attaches one waybill to two orders or two merchants', () => {
      expect(() =>
        run(
          `${actor(ownerId)} ${link(order('a'))} ${link(order('b'), proof(order('b')))}`
        )
      ).toThrow(/waybill_already_linked/);
      expect(() =>
        run(`${actor(ownerId)} ${link(order('a'))} ${asPostgres}
          ${actor(otherOwnerId)} ${link(order('f'), proof(order('f'), '2000000001', otherMerchantId))}`)
      ).toThrow(/waybill_already_linked/);
      // A typed self-fulfilment number on another merchant's order.
      expect(() =>
        run(
          `${actor(otherOwnerId)} ${link(order('f'), proof(order('f'), '2000000005', otherMerchantId))}`
        )
      ).toThrow(/waybill_already_linked/);
      // A typed self-fulfilment number on another order of the merchant.
      expect(() =>
        run(
          `${actor(ownerId)} ${link(order('a'), proof(order('a'), '2000000005'))}`
        )
      ).toThrow(/waybill_already_linked/);
    });

    it('lets a cancelled link release its waybill to another order', () => {
      expect(
        last(`${actor(ownerId)} ${link(order('a'))} ${asPostgres}
          UPDATE public.shipments SET status = 'cancelled' WHERE order_id = '${order('a')}';
          ${actor(ownerId)} ${link(order('b'), proof(order('b')))}`)
      ).toBe('t');
    });

    it('enforces the waybill uniqueness index for direct writers too', () => {
      const insert = (status: string) => `INSERT INTO public.shipments
        (merchant_id, provider, tracking_number, status, sender_address, receiver_address, items)
        VALUES ('${merchantId}', 'GIGL', ' tn-1 ', '${status}', '{}', '{}', '[]');`;
      expect(() => run(`${insert('booked')} ${insert('booked')}`)).toThrow(
        /shipments_provider_tracking_number_live_key/
      );
      expect(
        last(`${insert('cancelled')} ${insert('booked')} SELECT 'ok';`)
      ).toBe('ok');
    });

    it('refuses an order that already has a live shipment', () => {
      expect(() =>
        run(
          `${actor(ownerId)} ${link(order('a'))} ${link(order('a'), proof(order('a'), '2000000002'))}`
        )
      ).toThrow(/order_shipment_exists/);
    });

    it.each([
      [
        'a tampered payload',
        () => ({
          ...proof(order('a')),
          payload_text: '{"waybill":"2000000009"}',
        }),
      ],
      ['a proof for another order', () => proof(order('b'))],
      [
        'a proof for another merchant',
        () => proof(order('a'), '2000000001', otherMerchantId),
      ],
    ])('rejects %s', (_label, makeProof) => {
      expect(() =>
        run(`${actor(ownerId)} ${link(order('a'), makeProof())}`)
      ).toThrow(/external_waybill_proof_invalid/);
    });

    it('rejects a link when the order receiver changed after the GIG check', () => {
      const stale = proof(order('a'), '2000000001', merchantId, (p) => p, {
        customer_name: null,
        customer_phone: null,
        phone: null,
        state: 'Lagos',
      });
      expect(() => run(`${actor(ownerId)} ${link(order('a'), stale)}`)).toThrow(
        /order_changed_during_link/
      );
    });

    it('rejects a signed payload that GIG did not verify', () => {
      const unverified = proof(
        order('a'),
        '2000000001',
        merchantId,
        (payload) => ({
          ...payload,
          account_verified: false,
        })
      );
      expect(() =>
        run(`${actor(ownerId)} ${link(order('a'), unverified)}`)
      ).toThrow(/external_waybill_link_invalid/);
    });

    it.each([
      ['a delivered order', 'c', '', /order_not_linkable/],
      [
        'an order with a Baci wallet charge',
        'd',
        '',
        /active_merchant_shipping_charge/,
      ],
      [
        'an order cancelled through cancelled_at',
        '1',
        '',
        /order_not_linkable/,
      ],
      ['a customer-paid Baci GIG order', '2', '', /checkout_shipping_retained/],
      [
        'a merchant without GIG',
        'a',
        `UPDATE public.merchant_feature_settings SET shipping_providers = '["topship"]';`,
        /gigl_not_enabled/,
      ],
    ])('refuses %s', (_label, suffix, setup, error) => {
      expect(() =>
        run(
          `${setup} ${actor(ownerId)} ${link(order(suffix), proof(order(suffix)))}`
        )
      ).toThrow(error);
    });

    it('keeps the quote-economics guard for Baci bookings', () => {
      const insert = (
        extra: string,
        values: string
      ) => `INSERT INTO public.shipments
        (order_id, merchant_id, provider, tracking_number, sender_address, receiver_address, items${extra})
        VALUES ('${order('a')}', '${merchantId}', 'GIGL', '2000000007', '{}', '{}', '[]'${values});`;
      expect(() => run(insert('', ''))).toThrow(
        /gigl_shipment_quote_economics_missing/
      );
      expect(() =>
        run(
          insert(
            ', funding_source, shipping_quote_id',
            `, 'external_manual', '70000000-0000-4000-8000-000000000001'`
          )
        )
      ).toThrow(/external_shipment_invalid/);
    });
  }
);
