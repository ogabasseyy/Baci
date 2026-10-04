import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  processPiggyvestEvent: vi.fn(),
}));

vi.mock('@/env', () => ({
  getPiggyvestApiConfig: () => ({
    baseUrl: 'https://staging.example.com',
    token: process.env.PVB_SECRET_KEY?.trim() || 'synthetic',
  }),
  getPiggyvestWebhookSecret: () =>
    process.env.PVB_SECRET_KEY?.trim() || undefined,
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mocks.createServiceClient(),
}));

vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: (...args: unknown[]) =>
    mocks.processPiggyvestEvent(...args),
}));

import { GET, POST } from './route';

const SECRET = 'synthetic-staging-secret';

function chainable(
  result: { data: unknown; error: unknown },
  existing: unknown = MATCHING_ENVELOPE
): { query: Record<string, unknown>; upsert: ReturnType<typeof vi.fn> } {
  const query: Record<string, unknown> = {};
  const upsert = vi.fn(() => query);
  // select() is both awaitable (upsert result) and chainable (duplicate
  // verify read via .eq().maybeSingle()).
  const select = vi.fn(() =>
    Object.assign(Promise.resolve(result), {
      eq: vi.fn(() => ({
        maybeSingle: async () => ({ data: existing, error: null }),
      })),
    })
  );
  const then = (resolve: (value: unknown) => void) =>
    Promise.resolve(result).then(resolve);
  Object.assign(query, { select, then, upsert });
  return { query, upsert };
}

function signPayload(rawBody: string): string {
  return createHmac('sha512', SECRET).update(rawBody).digest('hex');
}

function createRequest(rawBody: string, signature?: string): NextRequest {
  return new NextRequest('https://usebaci.com/api/webhooks/piggyvest', {
    body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      ...(signature ? { 'x-pvb-signature': signature } : {}),
    },
    method: 'POST',
  });
}

const inflowEvent = {
  eventId: '4204dc18-efb3-44d0-b9a2-1362448d4f21',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'bank-transfer',
  customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  eventData: {
    id: 'faas-txn-synthetic-001',
    customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
    source_wallet_id: '',
    destination_wallet_id: 'faas-wallet-synthetic-001',
    type: 'inflow',
    category: 'bank_transfer_inflow',
    amount: 1750000,
    currency: 'NGN',
    narration: 'Transfer from SYNTHETIC SENDER',
    ip_address: '',
    transaction_id: 'provider-txn-synthetic-001',
    timestamp: '2026-09-15T10:12:00.000Z',
    status: 'success',
    third_party_reference: 'synthetic-third-party-ref',
    initiator_reference: 'synthetic-initiator-ref',
    internal_reference: 'synthetic-internal-ref',
    attempts: 1,
    provider: 'wema',
    destination_wallet_balance: 5000000,
    destination_wallet_ledger_balance: 5000000,
    destination_transaction_balance: 5000000,
    reference: 'faas-ref-synthetic-001',
    recipient_bank_account_number: '9000000001',
    recipient_bank_account_name: 'SYNTHETIC LTD',
    sender_bank_account_number: '0000000001',
    sender_bank_name: 'Synthetic Bank',
    sender_name: 'SYNTHETIC SENDER',
    session_id: '000000000001',
    fee: 0,
  },
  pvb_reference: 'pvb-txn-synthetic-001',
  pvb_wallet: 'pvb-wallet-synthetic-001',
  pvb_destination_wallet: null,
  pvb_third_party_reference: null,
  pvb_schedule_payment_id: null,
  pvb_destination_account_creation_reference: null,
  pvb_meta: null,
};

const MATCHING_ENVELOPE = {
  event_type: 'bank-transfer.inflow.success',
  event_category: 'bank-transfer',
  customer_id: inflowEvent.customer_id,
  wallet_id: inflowEvent.pvb_wallet,
  reference: inflowEvent.pvb_reference,
  amount_kobo: 1750000,
  event_details: { transaction_id: inflowEvent.eventData.transaction_id },
};

const restrictionEvent = {
  eventId: '6b9d2f4a-3c1e-4a5b-9d8f-2e4b6a8c0d12',
  eventType: 'restriction-created.success',
  eventCategory: 'restriction',
  customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  eventData: {},
  pvb_wallet: 'pvb-wallet-synthetic-001',
};

const interestEvent = {
  eventId: '01K8TESTINTEREST001',
  eventType: 'interest-payout.success',
  eventCategory: 'interest-payout',
  customer_id: 'faas-customer-synthetic-001',
  eventData: {
    id: 'faas-interest-synthetic-001',
    amount: 95000,
    destination_wallet: 'faas-wallet-synthetic-001',
    destination_wallet_balance: 1095000,
    destination_wallet_ledger_balance: 1095000,
    reference: 'faas-ref-synthetic-002',
    timestamp: '2026-09-01T00:05:00.000Z',
    batch_id: 'batch-synthetic-001',
    break_down: {
      gross_interest_payout: 100000,
      withholding_tax: 5000,
      net_interest_payout: 95000,
    },
  },
  pvb_reference: 'pvb-txn-synthetic-002',
  pvb_wallet: 'pvb-wallet-synthetic-001',
  pvb_accrued_interest_wallet: 'pvb-wallet-synthetic-001',
  pvb_destination_wallet: null,
  pvb_third_party_reference: null,
};

const outflowEvent = {
  eventId: '7cae305b-4d2f-4b6c-0e9a-3f5c7b9d1e23',
  eventType: 'bank-transfer.outflow.success',
  eventCategory: 'bank-transfer',
  customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  eventData: {
    reference: 'outflow-ref-001',
    third_party_reference: 'outflow-third-party-001',
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.processPiggyvestEvent.mockResolvedValue('processed');
});

describe('GET reachability probe', () => {
  it('answers 200 without requiring credentials', async () => {
    vi.stubEnv('PVB_SECRET_KEY', undefined);

    const probe = GET();

    expect(probe.status).toBe(200);
    expect(probe.headers.get('Cache-Control')).toBe('no-store');
    expect(await probe.json()).toEqual({
      ok: true,
      code: 'PIGGYVEST_WEBHOOK_REACHABLE',
    });
  });
});

describe('POST event intake', () => {
  it('acknowledges deferred processing as durable backlog', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(() => chainable({ data: [], error: null }).query),
    });
    mocks.processPiggyvestEvent.mockResolvedValue('deferred');
    const rawBody = JSON.stringify(inflowEvent);

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      deferred: true,
      duplicate: true,
    });
  });
  it('fails closed with 503 when no provider credentials are configured', async () => {
    vi.stubEnv('PVB_SECRET_KEY', undefined);

    const response = await POST(createRequest('{}', '0'.repeat(128)));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Integration unavailable',
      code: 'PIGGYVEST_NOT_READY',
    });
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('acks 200 without processing when the signature is invalid', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    const rawBody = JSON.stringify(inflowEvent);

    const response = await POST(createRequest(rawBody, '0'.repeat(128)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: false,
      code: 'PIGGYVEST_INVALID_SIGNATURE',
    });
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('records an authentic inflow and acks received', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    const { query, upsert } = chainable({
      data: [{ event_id: inflowEvent.eventId }],
      error: null,
    });
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(() => query),
    });
    const rawBody = JSON.stringify(inflowEvent);

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      duplicate: false,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: inflowEvent.eventId,
        event_type: 'bank-transfer.inflow.success',
        amount_kobo: 1750000,
        reference: 'pvb-txn-synthetic-001',
      }),
      { onConflict: 'event_id', ignoreDuplicates: true }
    );
  });

  it('acks duplicate deliveries and re-drives processing to recover crashed credits', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(() => chainable({ data: [], error: null }).query),
    });
    const rawBody = JSON.stringify(inflowEvent);

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      duplicate: true,
    });
  });

  it('quarantines authentic unknown events and acks without processing', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    const { query, upsert } = chainable({
      data: [{ body_digest: 'synthetic-digest' }],
      error: null,
    });
    const from = vi.fn(() => query);
    mocks.createServiceClient.mockReturnValue({ from });
    const rawBody = JSON.stringify({
      ...inflowEvent,
      eventType: 'wallet.transfer.success',
    });

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      quarantined: true,
    });
    expect(from).toHaveBeenCalledWith('piggyvest_event_quarantine');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'unknown-event',
        event_type: 'wallet.transfer.success',
      }),
      { onConflict: 'body_digest', ignoreDuplicates: true }
    );
    const persisted = upsert.mock.calls[0]?.[0];
    expect(JSON.stringify(persisted)).not.toContain('9000000001');
    expect(mocks.processPiggyvestEvent).not.toHaveBeenCalled();
  });

  it.each([
    { amount: 1 },
    { transaction_id: 'provider-txn-synthetic-002' },
  ])('quarantines same-identity conflicting deliveries without crediting: %j', async (changedDetail) => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    // Stored envelope keeps the original amount while the redelivery
    // claims amount 1: same identity, different content.
    const { query } = chainable({ data: [], error: null }, MATCHING_ENVELOPE);
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(() => query),
    });
    const rawBody = JSON.stringify({
      ...inflowEvent,
      eventData: { ...inflowEvent.eventData, ...changedDetail },
    });

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      quarantined: true,
    });
    expect(mocks.processPiggyvestEvent).not.toHaveBeenCalled();
  });

  it('returns 503 when the quarantine write fails so the provider redelivers', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(
        () =>
          chainable({ data: null, error: { message: 'synthetic db outage' } })
            .query
      ),
    });
    const rawBody = JSON.stringify({
      ...inflowEvent,
      eventType: 'wallet.transfer.success',
    });

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Event intake unavailable',
      code: 'PIGGYVEST_INBOX_ERROR',
    });
  });

  it('processes duplicate deliveries so crashed credits still land', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(() => chainable({ data: [], error: null }).query),
    });
    const rawBody = JSON.stringify(inflowEvent);

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(200);
    expect(mocks.processPiggyvestEvent).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when the processor throws so the provider redelivers', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    const { query } = chainable({
      data: [{ event_id: inflowEvent.eventId }],
      error: null,
    });
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(() => query),
    });
    mocks.processPiggyvestEvent.mockRejectedValue(new Error('synthetic'));
    const rawBody = JSON.stringify(inflowEvent);

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Event intake unavailable',
      code: 'PIGGYVEST_INBOX_ERROR',
    });
  });

  it('returns 503 without leaking internals when the inbox write fails', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(
        () =>
          chainable({ data: null, error: { message: 'synthetic db outage' } })
            .query
      ),
    });
    const rawBody = JSON.stringify(inflowEvent);

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Event intake unavailable',
      code: 'PIGGYVEST_INBOX_ERROR',
    });
  });

  it('records the wallet attribution a restriction flip acts on', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    const { query, upsert } = chainable({
      data: [{ event_id: restrictionEvent.eventId }],
      error: null,
    });
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(() => query),
    });
    const rawBody = JSON.stringify(restrictionEvent);

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: restrictionEvent.eventId,
        event_type: 'restriction-created.success',
        wallet_id: 'pvb-wallet-synthetic-001',
      }),
      { onConflict: 'event_id', ignoreDuplicates: true }
    );
  });

  it('records the destination plan wallet for interest payouts', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    const { query, upsert } = chainable({
      data: [{ event_id: interestEvent.eventId }],
      error: null,
    });
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(() => query),
    });
    const rawBody = JSON.stringify(interestEvent);

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: interestEvent.eventId,
        event_type: 'interest-payout.success',
        wallet_id: 'faas-wallet-synthetic-001',
      }),
      { onConflict: 'event_id', ignoreDuplicates: true }
    );
  });

  it('quarantines a restriction redelivery that reuses the event id with a different wallet', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    const { query } = chainable(
      { data: [], error: null },
      {
        event_type: 'restriction-created.success',
        event_category: 'restriction',
        customer_id: restrictionEvent.customer_id,
        wallet_id: 'pvb-wallet-synthetic-001',
        reference: null,
        amount_kobo: null,
      }
    );
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(() => query),
    });
    const rawBody = JSON.stringify({
      ...restrictionEvent,
      pvb_wallet: 'pvb-wallet-altered-002',
    });

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      quarantined: true,
    });
    expect(mocks.processPiggyvestEvent).not.toHaveBeenCalled();
  });

  it('records outflow reference candidates for conflict comparison', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    const { query, upsert } = chainable({
      data: [{ event_id: outflowEvent.eventId }],
      error: null,
    });
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(() => query),
    });
    const rawBody = JSON.stringify(outflowEvent);

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: outflowEvent.eventId,
        event_type: 'bank-transfer.outflow.success',
        reference: JSON.stringify([
          'outflow-ref-001',
          'outflow-third-party-001',
        ]),
      }),
      { onConflict: 'event_id', ignoreDuplicates: true }
    );
  });

  it('quarantines an outflow redelivery with altered references', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    const { query } = chainable(
      { data: [], error: null },
      {
        event_type: 'bank-transfer.outflow.success',
        event_category: 'bank-transfer',
        customer_id: outflowEvent.customer_id,
        wallet_id: null,
        reference: JSON.stringify([
          'outflow-ref-001',
          'outflow-third-party-001',
        ]),
        amount_kobo: null,
      }
    );
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(() => query),
    });
    const rawBody = JSON.stringify({
      ...outflowEvent,
      eventData: {
        ...outflowEvent.eventData,
        reference: 'outflow-ref-altered',
      },
    });

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      quarantined: true,
    });
    expect(mocks.processPiggyvestEvent).not.toHaveBeenCalled();
  });
});
