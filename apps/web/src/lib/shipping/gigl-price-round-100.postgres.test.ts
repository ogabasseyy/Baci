import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { extractSqlFunctionDefinition } from '../../../../../supabase/tests/extract-sql-function-definition.mjs';
import { createShippingQuoteProofTestDatabase } from '../../../../../supabase/tests/shipping-quote-proof-postgres-test-harness.mjs';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';

const merchantId = '10000000-0000-4000-8000-000000000001';
const orderId = '40000000-0000-4000-8000-000000000001';
const ownerId = '20000000-0000-4000-8000-000000000001';
const COST = 44_091.27;

function json(value: unknown) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

function quote(price: number, cost = COST) {
  return {
    id: randomUUID(),
    merchant_id: merchantId,
    session_id: orderId,
    provider: 'GIGL',
    service_tier: 'standard',
    carrier_name: 'GIG Logistics',
    price,
    provider_cost: cost,
    platform_margin: Math.round((price - cost) * 100) / 100,
    platform_margin_bps: 1000,
    pricing_version: 'gigl_platform_margin_v1',
    currency: 'NGN',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    quote_request: { shipmentType: 'domestic', sender: { city: 'Lagos' } },
  };
}

// Dedicated DB CI invokes this explicitly with BACI_SHIPPING_QUOTE_POSTGRES=1.
describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'GIGL NGN 100 price rounding in PostgreSQL',
  () => {
    const database = createShippingQuoteProofTestDatabase();
    beforeAll(async () => {
      await database.start();
      // The proof-bound Admin wrapper is the authenticated entry point.
      database.query(
        `${extractSqlFunctionDefinition(
          readFileSync(
            resolve(
              process.cwd(),
              '../../supabase/migrations/20260903135000_attest_shipping_quote_writes_and_shipment_grants.sql'
            ),
            'utf8'
          ),
          'public',
          'persist_authenticated_admin_gigl_quote'
        )}
        GRANT EXECUTE ON FUNCTION public.persist_authenticated_admin_gigl_quote(jsonb,jsonb,jsonb) TO authenticated;`
      );
    }, 60000);
    afterAll(() => database.stop());

    function asOwner(statement: string) {
      return database.query(`BEGIN;
        SELECT set_config('request.jwt.claim.role','authenticated',true);
        SELECT set_config('request.jwt.claim.sub','${ownerId}',true);
        SET LOCAL ROLE authenticated;
        ${statement}
        COMMIT;`);
    }

    function refresh(value: ReturnType<typeof quote>) {
      const proof = createShippingQuoteRouteProof({
        action: 'persist_refreshed_order_shipping_quote',
        merchantId,
        subjectId: orderId,
        payload: { order_id: orderId, quote: value },
      });
      return asOwner(
        `SELECT public.persist_refreshed_order_shipping_quote('${orderId}',${json(value)},${json(proof)});`
      );
    }

    function adminQuote(value: ReturnType<typeof quote>) {
      const attestation = {
        order_id: orderId,
        merchant_id: merchantId,
        quote_request: value.quote_request,
      };
      const proof = createShippingQuoteRouteProof({
        action: 'persist_authenticated_admin_gigl_quote',
        merchantId,
        subjectId: orderId,
        payload: { quote: value, attestation },
      });
      return asOwner(
        `SELECT public.persist_authenticated_admin_gigl_quote(${json(value)},${json(attestation)},${json(proof)});`
      );
    }

    function stored(id: string) {
      return database
        .query(
          `SELECT price || '|' || platform_margin FROM public.shipping_quotes WHERE id='${id}';`
        )
        .trim();
    }

    it.each([
      ['NGN 100 rounded', 48_600, '48600|4508.73'],
      ['unrounded v1', 48_500.4, '48500.4|4409.13'],
    ])('accepts the %s refreshed price', (_label, price, expected) => {
      const value = quote(price);
      expect(refresh(value)).toContain(value.id);
      expect(stored(value.id)).toBe(expected);
    });

    it.each([48_599, 48_700])('rejects refreshed price %d', (price) => {
      const value = quote(price);
      expect(() => refresh(value)).toThrow(/invalid_refreshed_quote/);
      expect(stored(value.id)).toBe('');
    });

    it.each([48_600, 48_500.4])('accepts Admin quote price %d', (price) => {
      const value = quote(price);
      expect(adminQuote(value)).toContain(value.id);
      expect(stored(value.id)).not.toBe('');
    });

    it.each([48_599, 48_700])('rejects Admin quote price %d', (price) => {
      const value = quote(price);
      expect(() => adminQuote(value)).toThrow(/invalid_admin_quote/);
      expect(stored(value.id)).toBe('');
    });

    it('keeps exact NGN 100 multiples and rejects a price one boundary up', () => {
      expect(
        database
          .query(`SELECT private.gigl_v1_price_matches_cost(10000, 11000),
            private.gigl_v1_price_matches_cost(10000, 11100),
            private.gigl_v1_price_matches_cost(909.10, 1100),
            private.gigl_v1_price_matches_cost(909.10, 1000.01),
            private.gigl_v1_price_matches_cost(909.10, 1200);`)
          .trim()
      ).toBe('t|f|t|t|f');
    });

    it('keeps the helper and both 2-arg writers closed to clients', () => {
      expect(
        database
          .query(`SELECT
            has_function_privilege('anon','private.gigl_v1_price_matches_cost(numeric,numeric)','EXECUTE'),
            has_function_privilege('authenticated','private.gigl_v1_price_matches_cost(numeric,numeric)','EXECUTE'),
            has_function_privilege('authenticated','public.persist_refreshed_order_shipping_quote(uuid,jsonb)','EXECUTE'),
            has_function_privilege('authenticated','public.persist_authenticated_admin_gigl_quote(jsonb,jsonb)','EXECUTE');`)
          .trim()
      ).toBe('f|f|f|f');
    });
  }
);
