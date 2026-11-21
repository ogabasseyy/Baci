import { execFileSync } from 'node:child_process';
import { expect } from 'vitest';
import { POST as reconcile } from '@/app/api/internal/partner-order-reconciliation/route';
import { GET as tracking } from './orders/[orderId]/route';
import { POST as submit } from './orders/route';
import { expectPartnerResponse } from './partner-openapi.test-support';

const pgSocket = process.env.BACI_PARTNER_LIFECYCLE_SOCKET;
const pgPort = process.env.BACI_PARTNER_LIFECYCLE_PORT;

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
  assertFixtureId(orderId);
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
      IF public.read_settled_partner_delivery(v_order.id, v_order.merchant_id)
         IS DISTINCT FROM '{"service":"Standard","delivery_minor":150000}'::jsonb THEN
        RAISE EXCEPTION 'admin route could not read settled delivery terms';
      END IF;
      BEGIN
        UPDATE public.orders SET shipping_status = 'shipped' WHERE id = v_order.id;
        RAISE EXCEPTION 'unbound partner order was marked shipped' USING ERRCODE = '22023';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'partner_shipping_requires_merchant_wallet' THEN RAISE; END IF;
      END;
      v_quote_id := private.seed_fixture_gigl_quote(v_order.id, 1500, 'GoFaster');
      BEGIN
        PERFORM public.bind_admin_gigl_quote(v_order.id, v_order.merchant_id,
          v_quote_id, v_order.shipping_address);
        RAISE EXCEPTION 'a different GIG service was bound at the same price' USING ERRCODE = '22023';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'partner_delivery_service_changed' THEN RAISE; END IF;
      END;
      v_quote_id := private.seed_fixture_gigl_quote(v_order.id, 1501);
      BEGIN
        PERFORM public.bind_admin_gigl_quote(v_order.id, v_order.merchant_id,
          v_quote_id, v_order.shipping_address);
        RAISE EXCEPTION 'unsettled rate increase was bound';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'partner_delivery_price_changed' THEN RAISE; END IF;
      END;
      v_quote_id := private.seed_fixture_gigl_quote(v_order.id, 1499);
      BEGIN
        PERFORM public.bind_admin_gigl_quote(v_order.id, v_order.merchant_id,
          v_quote_id, v_order.shipping_address);
        RAISE EXCEPTION 'cheaper rate was bound without reconciling the settled amount' USING ERRCODE = '22023';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'partner_delivery_price_changed' THEN RAISE; END IF;
      END;
      v_quote_id := private.seed_fixture_gigl_quote(
        v_order.id, 1500, 'Standard', '{"postalCode":"999999"}'
      );
      BEGIN
        PERFORM public.bind_admin_gigl_quote(v_order.id, v_order.merchant_id,
          v_quote_id, v_order.shipping_address || '{"postalCode":"999999"}');
        RAISE EXCEPTION 'a different destination was bound at the same price' USING ERRCODE = '22023';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'partner_delivery_destination_changed' THEN RAISE; END IF;
      END;
      FOR v_quote_id IN
        SELECT private.seed_fixture_gigl_quote(v_order.id, 1500, 'Standard', '{}', '{"address":"Other pickup"}')
        UNION ALL
        SELECT private.seed_fixture_gigl_quote(v_order.id, 1500, 'Standard', '{}', '{}', 1)
      LOOP
        BEGIN
          PERFORM public.bind_admin_gigl_quote(v_order.id, v_order.merchant_id,
            v_quote_id, v_order.shipping_address);
          RAISE EXCEPTION 'a different pickup or parcel was bound at the same price' USING ERRCODE = '22023';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM <> 'partner_delivery_origin_or_parcel_changed' THEN RAISE; END IF;
        END;
      END LOOP;
      v_quote_id := private.seed_fixture_gigl_quote(v_order.id, 1499.999);
      PERFORM public.bind_admin_gigl_quote(v_order.id, v_order.merchant_id,
        v_quote_id, v_order.shipping_address);
    END;
    $$;
    SELECT shipping_status, shipping_funding_source, shipping_provider, (selected_quote_id IS NOT NULL)
    FROM public.orders WHERE id = '${orderId}';
  `)
  ).toBe('processing|merchant_wallet|GIGL|t');
}
function assertFixtureId(id: string) {
  expect(id).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
  );
}

async function verifyPartnerTracking(
  orderId: string,
  tokens: { order: string; other: string }
) {
  assertFixtureId(orderId);
  const operation = 'GET /orders/{orderId}';
  const state = (token = tokens.order) =>
    tracking(request(`partners/v1/orders/${orderId}`, token), {
      params: Promise.resolve({ orderId }),
    });
  expect((await expectJson(await state(), 200, operation)).tracking).toBeNull();
  await expectJson(await state(tokens.other), 404, operation);
  verifyGiglWalletBinding(orderId);
  expect(await expectJson(await state(), 200, operation)).toMatchObject({
    shipping_status: 'processing',
    tracking: null,
  });
  // Substitute the carrier booking result persisted by fulfillment.
  fixtureSql(`
    UPDATE public.orders SET shipping_status = 'shipped', shipping_provider = 'GIGL',
      tracking_number = 'FIXTURE-GIG-WAYBILL' WHERE id = '${orderId}';
  `);
  expect(await expectJson(await state(), 200, operation)).toMatchObject({
    shipping_status: 'shipped',
    tracking: { provider: 'GIGL', tracking_number: 'FIXTURE-GIG-WAYBILL' },
  });
}

async function verifyAcceptedEvidenceReplay<T extends { settlement: object }>(
  token: string,
  evidence: T
) {
  const send = (body: object) =>
    reconcile(request('internal/partner-order-reconciliation', token, body));
  expect((await expectJson(await send(evidence), 200)).receipt.status).toBe(
    'accepted'
  );
  const changed = await expectJson(
    await send({
      ...evidence,
      settlement: { ...evidence.settlement, allocation_reference: 'changed' },
    }),
    409
  );
  expect(changed.error.code).toBe('SETTLEMENT_EVIDENCE_CONFLICT');
}

async function verifyCatalogDriftHold(
  quoteId: string,
  runReconciliation: (newQuoteId: string) => Promise<Response>
) {
  assertFixtureId(quoteId);
  const newQuoteId = fixtureSql(`
    INSERT INTO private.partner_delivery_quotes (id, merchant_id, connection_id, created_at, expires_at, snapshot)
    SELECT gen_random_uuid(), merchant_id, connection_id, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '5 minutes', snapshot
    FROM private.partner_delivery_quotes WHERE id = '${quoteId}' RETURNING id;
    UPDATE public.products SET status = 'archived'
    WHERE id = '7a100000-0000-4000-8000-000000000011';
  `);
  assertFixtureId(newQuoteId);

  const held = await expectJson(await runReconciliation(newQuoteId), 202);
  expect(held.hold_reason).toBe('ORDER_REVIEW_REQUIRED');
  expect(
    fixtureSql(`
    SELECT EXISTS (
      SELECT 1 FROM private.partner_order_submissions s
      JOIN private.partner_payment_captures c ON c.submission_id = s.id
      JOIN private.partner_order_settlements e ON e.submission_id = s.id
      JOIN private.partner_order_review_holds h ON h.submission_id = s.id
      WHERE s.quote_id = '${newQuoteId}' AND h.reason = 'ORDER_REVIEW_REQUIRED'
    );
    SELECT count(*) FROM public.orders;
  `)
  ).toBe('t\n1');
}

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

async function expectJson(
  response: Response,
  status: number,
  operation?: Parameters<typeof expectPartnerResponse>[0]
) {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(status);
  if (operation) expectPartnerResponse(operation, status, body);
  return body;
}
async function verifyConcurrentRetry(
  send: () => Promise<Response>,
  expectedStatus: number,
  operation?: Parameters<typeof expectPartnerResponse>[0]
) {
  const [first, retry] = await Promise.all([
    send().then((response) => expectJson(response, expectedStatus, operation)),
    send().then((response) => expectJson(response, expectedStatus, operation)),
  ]);
  const { request_id: firstRequestId, ...firstReceipt } = first;
  const { request_id: retryRequestId, ...retryReceipt } = retry;
  expect(firstRequestId).not.toBe(retryRequestId);
  expect(retryReceipt).toEqual(firstReceipt);
  return firstReceipt;
}

async function reconcileAfterCatalogDrift(
  tokens: { order: string; verify: string },
  quoteId: string,
  originalOrder: { recipient: object; payment: object },
  originalEvidence: { settlement: object }
) {
  const payment = { ...originalOrder.payment, reference: 'drift-capture' };
  const partnerOrderId = 'lifecycle-order-with-catalog-drift';
  const capturedAt = new Date().toISOString();
  const pending = await expectJson(
    await submit(
      request(
        'partners/v1/orders',
        tokens.order,
        {
          ...originalOrder,
          payment,
          quote_id: quoteId,
          partner_order_id: partnerOrderId,
        },
        { 'Idempotency-Key': 'fixture-order-idempotency-drift' }
      )
    ),
    202
  );
  return reconcile(
    request('internal/partner-order-reconciliation', tokens.verify, {
      submission_id: pending.submission_id,
      quote_id: quoteId,
      partner_order_id: partnerOrderId,
      capture: {
        ...payment,
        provider_account: 'fixture-provider-account',
        captured_at: capturedAt,
      },
      settlement: {
        ...originalEvidence.settlement,
        allocation_reference: 'drift-allocation',
        settled_at: new Date().toISOString(),
      },
    })
  );
}

const fixtureEnabled = Boolean(pgSocket && pgPort);

export {
  expectJson,
  fixtureEnabled,
  fixtureSql,
  reconcileAfterCatalogDrift,
  request,
  verifyAcceptedEvidenceReplay,
  verifyCatalogDriftHold,
  verifyConcurrentRetry,
  verifyPartnerTracking,
};
