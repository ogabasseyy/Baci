import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as reconcile } from '@/app/api/internal/partner-order-reconciliation/route';
import { GET as catalog } from './catalog/route';
import { GET as lookup } from './order-submissions/route';
import { GET as tracking } from './orders/[orderId]/route';
import { POST as submit } from './orders/route';
import { POST as quote } from './quotes/route';

vi.mock('@/lib/tenant-rate-limit', () => ({
  checkTenantRateLimitDetailed: async () => ({ verdict: 'allowed' }),
}));
vi.mock('@/app/api/shipping/quotes/resolve-public-merchant-sender', () => ({
  resolvePublicMerchantSender: async () => ({
    ok: true,
    sender: {
      address: '1 Merchant Road',
      city: 'Ikeja',
      state: 'Lagos',
      countryCode: 'NG',
    },
  }),
}));
vi.mock('@/lib/shipping', () => ({
  shippingService: {
    getProviderQuotes: async () => [
      {
        id: crypto.randomUUID(),
        provider: 'GIGL',
        currency: 'NGN',
        providerRateId: 'fixture-gig-rate',
        price: 1500,
        providerCost: 1000,
        serviceTier: 'Standard',
        estimatedDays: 2,
        expiresAt: new Date(Date.now() + 600_000),
      },
    ],
  },
}));
vi.mock('./partner-profiles', () => {
  const listings = [
    {
      listing_id: 'fixture-new-phone',
      product_id: '7a100000-0000-4000-8000-000000000011',
      variant_id: null,
      offer_id: null,
      title: 'Fixture new phone',
      condition: 'new',
      availability: 'in_stock',
      price_minor: 10600,
      base_price_minor: 10000,
    },
  ];
  return {
    getPartnerProfiles: () => [
      {
        id: 'fixture-api-merchant',
        merchantId: '7a100000-0000-4000-8000-000000000001',
        credentials: [
          { token: tokens.catalog, scopes: ['catalog:read'] },
          { token: tokens.quote, scopes: ['quotes:write'] },
          { token: tokens.order, scopes: ['orders:write', 'orders:read'] },
          { token: tokens.verify, scopes: ['reconciliation:write'] },
        ],
        loadCatalog: async () => ({ listings }),
        readCatalogSnapshot: async (validator: string | null) => ({
          etag: '"fixture-feed-v1"',
          body:
            validator === '"fixture-feed-v1"'
              ? null
              : JSON.stringify({ listings }),
        }),
        delivery: {
          carrier: 'GIGL',
          validityMs: 600_000,
          settlementBasis: 'base_plus_delivery',
        },
      },
      {
        id: 'fixture-api-other-connection',
        merchantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        credentials: [{ token: tokens.other, scopes: ['orders:read'] }],
      },
    ],
  };
});

const tokens = {
  catalog: 'fixture-merchant-lifecycle-catalog-token-000001',
  quote: 'fixture-merchant-lifecycle-quote-token-00000001',
  order: 'fixture-merchant-lifecycle-order-token-00000001',
  verify: 'fixture-merchant-lifecycle-verifier-token-00001',
  other: 'fixture-merchant-lifecycle-other-token-00000001',
};

const pgSocket = process.env.BACI_PARTNER_LIFECYCLE_SOCKET;
const pgPort = process.env.BACI_PARTNER_LIFECYCLE_PORT;

function request(
  path: string,
  token: string,
  body?: object,
  headers?: HeadersInit
) {
  const allHeaders = new Headers(headers);
  allHeaders.set('Authorization', `Bearer ${token}`);
  if (body) allHeaders.set('Content-Type', 'application/json');
  return new Request(`http://baci-fixture.invalid/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: allHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function expectJson(response: Response, status: number) {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(status);
  return body;
}

function fixtureSql(sql: string) {
  if (
    !pgSocket?.includes('baci-partner-api-') ||
    !pgPort ||
    !/^\d+$/.test(pgPort)
  ) {
    throw new Error(
      'Run this test through the disposable partner API launcher'
    );
  }
  return execFileSync(
    'psql',
    [
      '-XAtq',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      pgSocket,
      '-p',
      pgPort,
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    { input: sql, encoding: 'utf8' }
  ).trim();
}

function verifyGiglWalletBinding(orderId: string) {
  expect(
    fixtureSql(`
    UPDATE public.orders SET shipping_status = 'processing' WHERE id = '${orderId}';
    DO $$
    DECLARE
      v_order public.orders%ROWTYPE;
      v_quote_id uuid;
    BEGIN
      PERFORM set_config('baci_fixture.staff', '7a100000-0000-4000-8000-000000000101', true);
      SELECT * INTO STRICT v_order FROM public.orders WHERE id = '${orderId}';
      v_quote_id := private.seed_fixture_gigl_quote(v_order.id, 1501);
      BEGIN
        PERFORM public.bind_admin_gigl_quote(v_order.id, v_order.merchant_id,
          v_quote_id, v_order.shipping_address);
        RAISE EXCEPTION 'unsettled rate increase was bound';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'partner_delivery_price_changed' THEN RAISE; END IF;
      END;
      v_quote_id := private.seed_fixture_gigl_quote(v_order.id, 1500);
      PERFORM public.bind_admin_gigl_quote(v_order.id, v_order.merchant_id,
        v_quote_id, v_order.shipping_address);
    END;
    $$;
    SELECT shipping_status, shipping_funding_source, shipping_provider,
      (selected_quote_id IS NOT NULL) FROM public.orders WHERE id = '${orderId}';
  `)
  ).toBe('processing|merchant_wallet|GIGL|t');
}

describe.runIf(Boolean(pgSocket && pgPort))(
  'partner API lifecycle with real database',
  () => {
    beforeEach(() => {
      const fixtureBase = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!fixtureBase || !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixtureBase)) {
        throw new Error('Partner lifecycle requires a local PostgREST address');
      }
      const fetchOriginal = globalThis.fetch;
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (
          url.origin !== fixtureBase ||
          !url.pathname.startsWith('/rest/v1/')
        ) {
          throw new Error(
            'Unexpected outbound request in partner lifecycle fixture'
          );
        }
        url.pathname = url.pathname.slice('/rest/v1'.length);
        return fetchOriginal(url, init);
      });
    });

    afterEach(() => vi.unstubAllGlobals());

    it('imports a listing, quotes, reconciles one paid order and exposes its waybill to its connection', async () => {
      const feedPath = 'partners/v1/catalog';
      const feed = await catalog(request(feedPath, tokens.catalog));
      const validator = feed.headers.get('ETag');
      expect(validator).toBeTruthy();
      const { listings } = await expectJson(feed, 200);
      const unchanged = await catalog(
        request(feedPath, tokens.catalog, undefined, {
          'If-None-Match': validator ?? '',
        })
      );
      expect(unchanged.status).toBe(304);
      expect(await unchanged.text()).toBe('');

      const quoted = await expectJson(
        await quote(
          request('partners/v1/quotes', tokens.quote, {
            items: [{ listing_id: listings[0].listing_id, quantity: 2 }],
            destination: {
              address_line1: '10 Buyer Road',
              city: 'Ikeja',
              state: 'Lagos',
              country_code: 'NG',
            },
          })
        ),
        201
      );
      expect(quoted).toMatchObject({
        delivery_minor: 150000,
        subtotal_minor: 21200,
        tax_minor: 1500,
        total_minor: 172700,
      });

      expect(quoted.quote_id).toMatch(/^[a-f0-9-]{36}$/);
      const capturedAt = new Date().toISOString();
      // Advance the stored expiry in the disposable DB to exercise a late delivery.
      const expiredAt = fixtureSql(`
        UPDATE private.partner_delivery_quotes SET expires_at = clock_timestamp()
        WHERE id = '${quoted.quote_id}'
        RETURNING to_json(expires_at) #>> '{}';
      `);
      const partnerOrderId = 'lifecycle-order';
      const orderPayload = {
        quote_id: quoted.quote_id,
        partner_order_id: partnerOrderId,
        recipient: {
          name: 'Fixture Buyer',
          phone: '+2348000000000',
          email: 'buyer@example.invalid',
        },
        payment: {
          source: 'fixture',
          reference: 'lifecycle-capture',
          amount_minor: quoted.total_minor,
          currency: 'NGN',
        },
      };
      const purchase = () =>
        submit(
          request('partners/v1/orders', tokens.order, orderPayload, {
            'Idempotency-Key': 'fixture-order-idempotency-0001',
          })
        );
      const pending = await expectJson(await purchase(), 202);
      expect(pending.status).toBe('pending_verification');
      const receiptPath = `partners/v1/order-submissions?partner_order_id=${partnerOrderId}`;
      expect(
        (
          await expectJson(
            await lookup(request(receiptPath, tokens.order)),
            200
          )
        ).submission_id
      ).toBe(pending.submission_id);
      expect((await lookup(request(receiptPath, tokens.other))).status).toBe(
        404
      );

      const reconcilePath = 'internal/partner-order-reconciliation';
      const evidence = {
        submission_id: pending.submission_id,
        quote_id: quoted.quote_id,
        partner_order_id: partnerOrderId,
        capture: {
          ...orderPayload.payment,
          provider_account: 'fixture-provider-account',
          captured_at: capturedAt,
        },
        settlement: {
          source: 'fixture_payout',
          settlement_account: 'fixture-merchant-account',
          payout_reference: 'fixture-payout',
          allocation_reference: 'fixture-allocation',
          amount_minor: 171500,
          currency: 'NGN',
          settled_at: new Date().toISOString(),
        },
      };
      expect(
        (await reconcile(request(reconcilePath, tokens.order, evidence))).status
      ).toBe(404);
      await expectJson(
        await reconcile(
          request(reconcilePath, tokens.verify, {
            ...evidence,
            capture: { ...evidence.capture, captured_at: expiredAt },
          })
        ),
        400
      );
      const held = await expectJson(
        await reconcile(
          request(reconcilePath, tokens.verify, {
            ...evidence,
            settlement: { ...evidence.settlement, amount_minor: 1 },
          })
        ),
        202
      );
      expect(held.hold_reason).toBe('SETTLEMENT_REVIEW_REQUIRED');
      expect(fixtureSql('SELECT count(*) FROM public.orders;')).toBe('0');

      const accepted = await expectJson(
        await reconcile(request(reconcilePath, tokens.verify, evidence)),
        200
      );
      expect(accepted.receipt.status).toBe('accepted');
      const { order_id: orderId } = accepted.receipt;
      expect(orderId).toMatch(/^[a-f0-9-]{36}$/);
      expect((await expectJson(await purchase(), 200)).order_id).toBe(orderId);
      expect(
        fixtureSql(`
      SELECT count(*) FROM public.orders;
      SELECT count(*) FROM public.transactions WHERE gateway = 'partner_settlement' AND amount = 1715;
      SELECT stock_quantity FROM public.products WHERE id = '7a100000-0000-4000-8000-000000000011';
    `)
      ).toBe('1\n1\n8');

      const state = (token = tokens.order) =>
        tracking(request(`partners/v1/orders/${orderId}`, token), {
          params: Promise.resolve({ orderId }),
        });
      expect((await expectJson(await state(), 200)).tracking).toBeNull();
      expect((await state(tokens.other)).status).toBe(404);
      verifyGiglWalletBinding(orderId);
      expect(await expectJson(await state(), 200)).toMatchObject({
        shipping_status: 'processing',
        tracking: null,
      });
      // Substitute the carrier booking result persisted by fulfillment.
      fixtureSql(`UPDATE public.orders SET shipping_status = 'shipped', shipping_provider = 'GIGL',
      tracking_number = 'FIXTURE-GIG-WAYBILL' WHERE id = '${orderId}';`);
      expect(await expectJson(await state(), 200)).toMatchObject({
        shipping_status: 'shipped',
        tracking: { provider: 'GIGL', tracking_number: 'FIXTURE-GIG-WAYBILL' },
      });
    }, 20_000);
  }
);
