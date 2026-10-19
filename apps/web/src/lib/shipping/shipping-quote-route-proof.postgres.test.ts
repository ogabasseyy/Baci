import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createShippingQuoteProofTestDatabase } from '../../../../../supabase/tests/shipping-quote-proof-postgres-test-harness.mjs';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';

const merchantId = '10000000-0000-4000-8000-000000000001';
const orderId = '40000000-0000-4000-8000-000000000001';
const ownerId = '20000000-0000-4000-8000-000000000001';
const action = 'persist_refreshed_order_shipping_quote';

function json(value: unknown) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

function quote() {
  return {
    id: randomUUID(),
    merchant_id: merchantId,
    session_id: orderId,
    provider: 'GIGL',
    service_tier: 'standard',
    carrier_name: 'GIG Logistics',
    price: 110,
    provider_cost: 100,
    platform_margin: 10,
    platform_margin_bps: 1000,
    pricing_version: 'gigl_platform_margin_v1',
    currency: 'NGN',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    quote_request: { shipmentType: 'domestic', sender: { city: 'Lagos' } },
  };
}

function proof(value: ReturnType<typeof quote>, now?: string) {
  return createShippingQuoteRouteProof({
    action,
    merchantId,
    subjectId: orderId,
    now,
    payload: { order_id: orderId, quote: value },
  });
}

// Dedicated DB CI invokes this explicitly. Ordinary web unit shards skip
// Docker, while the production signer and PostgreSQL verifier run together.
describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'shipping quote proof PostgreSQL boundary',
  () => {
    const database = createShippingQuoteProofTestDatabase({
      beforeFix: process.env.BACI_SHIPPING_QUOTE_BEFORE_FIX === '1',
    });
    beforeAll(async () => database.start(), 60000);
    afterAll(() => database.stop());

    function persist(
      value: ReturnType<typeof quote>,
      signed = proof(value),
      actor = ownerId
    ) {
      return database.query(`BEGIN;
        SELECT set_config('request.jwt.claim.role','authenticated',true);
        SELECT set_config('request.jwt.claim.sub','${actor}',true);
        SET LOCAL ROLE authenticated;
        SELECT public.persist_refreshed_order_shipping_quote('${orderId}',${json(value)},${json(signed)});
        COMMIT;`);
    }

    function verify(signed: ReturnType<typeof proof>, proofAction = action) {
      return database
        .query(`SELECT private.verify_shipping_quote_route_proof(
        ${json(signed)},'${proofAction}','${orderId}','${merchantId}');`)
        .trim();
    }

    it('persists a refreshed GIGL quote signed by the production TypeScript signer', () => {
      const value = quote();
      expect(persist(value)).toContain(value.id);
      expect(
        database
          .query(
            `SELECT id FROM public.shipping_quotes WHERE id='${value.id}';`
          )
          .trim()
      ).toBe(value.id);
      expect(
        database
          .query(
            `SELECT selected_quote_id FROM public.orders WHERE id='${orderId}';`
          )
          .trim()
      ).toBe(value.id);
    });

    it('preserves paid checkout funding and retained economics during refresh', () => {
      const value = quote();
      persist(value);
      expect(
        database
          .query(`SELECT json_build_array(shipping_funding_source,
        shipping_provider_cost,shipping_platform_margin,shipping_platform_retained_amount)
        FROM public.orders WHERE id='${orderId}';`)
          .trim()
      ).toBe('["customer_checkout", 90, 20, 110]');
    });

    it('rejects an altered replacement quote and does not insert it', () => {
      const value = quote();
      const signed = proof(value);
      value.price = 111;
      expect(() => persist(value, signed)).toThrow(
        /42501.*invalid_shipping_quote_route_proof/s
      );
      expect(
        database
          .query(
            `SELECT count(*) FROM public.shipping_quotes WHERE id='${value.id}';`
          )
          .trim()
      ).toBe('0');
    });

    it('rejects a changed signature', () => {
      const signed = proof(quote());
      signed.signature = '0'.repeat(64);
      expect(verify(signed)).toBe('f');
    });

    it('also accepts a production-signed Admin GIGL quote proof', () => {
      const proofAction = 'persist_authenticated_admin_gigl_quote';
      const signed = createShippingQuoteRouteProof({
        action: proofAction,
        merchantId,
        subjectId: orderId,
        payload: { quote: quote(), attestation: { order_id: orderId } },
      });
      expect(verify(signed, proofAction)).toBe('t');
    });

    it('rejects proofs issued more than five minutes ago or over thirty seconds ahead', () => {
      for (const offset of [-600000, 60000]) {
        expect(
          verify(proof(quote(), new Date(Date.now() + offset).toISOString()))
        ).toBe('f');
      }
    });

    it('rejects missing identity fields and malformed payload text', () => {
      const signed = proof(quote());
      expect(verify({ ...signed, merchant_id: '' })).toBe('f');
      expect(verify({ ...signed, subject_id: '' })).toBe('f');
      expect(verify({ ...signed, issued_at: '' })).toBe('f');
      expect(verify({ ...signed, payload_text: 'invalid JSON' })).toBe('f');
    });

    it('binds the action and exact UTF-8 payload including JSON key order', () => {
      const value = quote();
      value.quote_request.sender.city = "Ikeja – O'Connell";
      const signed = proof(value);
      expect(verify(signed)).toBe('t');
      expect(verify(signed, 'persist_authenticated_admin_gigl_quote')).toBe(
        'f'
      );
      expect(
        verify({
          ...signed,
          payload_text: JSON.stringify({ quote: value, order_id: orderId }),
        })
      ).toBe('f');
    });

    it('denies a foreign merchant even when the server proof is valid', () => {
      const value = quote();
      expect(() =>
        persist(value, proof(value), '20000000-0000-4000-8000-000000000002')
      ).toThrow(/42501.*forbidden/s);
      expect(
        database
          .query(
            `SELECT count(*) FROM public.shipping_quotes WHERE id='${value.id}';`
          )
          .trim()
      ).toBe('0');
    });

    it('fails closed when the Vault signing secret is unavailable', () => {
      const signed = proof(quote());
      expect(
        database
          .query(`BEGIN; DELETE FROM vault.decrypted_secrets;
        SELECT private.verify_shipping_quote_route_proof(${json(signed)},'${action}','${orderId}','${merchantId}');
        ROLLBACK;`)
          .trim()
      ).toBe('f');
    });

    it('keeps the verifier and unproved quote writer inaccessible to authenticated clients', () => {
      expect(
        database
          .query(`SELECT has_schema_privilege('authenticated','private','USAGE'),
        has_function_privilege('authenticated','private.verify_shipping_quote_route_proof(jsonb,text,uuid,uuid)','EXECUTE'),
        has_function_privilege('service_role','private.verify_shipping_quote_route_proof(jsonb,text,uuid,uuid)','EXECUTE'),
        has_function_privilege('authenticated','public.persist_refreshed_order_shipping_quote(uuid,jsonb)','EXECUTE');`)
          .trim()
      ).toBe('f|f|f|f');
    });
  }
);
