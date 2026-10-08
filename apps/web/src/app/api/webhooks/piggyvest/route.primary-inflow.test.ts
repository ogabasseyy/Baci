import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  intake: vi.fn(),
  dispatch: vi.fn(),
  legacyClient: vi.fn(),
  legacyRecord: vi.fn(),
  legacyProcess: vi.fn(),
  quarantine: vi.fn(),
  families: ['bank'] as string[],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getPiggyvestWebhookSecret: () => 'fixture-secret',
  getPiggyvestApiConfig: () => undefined,
}));
vi.mock('@/lib/piggyvest/webhook-secret-union', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/piggyvest/webhook-secret-union')
    >();
  return {
    ...actual,
    verifyPiggyvestWebhookSecrets: (input: {
      rawBody: Uint8Array;
      signature: string | null;
    }) => {
      const secret = actual.matchPiggyvestWebhookSecret({
        ...input,
        secrets: ['fixture-secret'],
      });
      return secret
        ? {
            status: 'verified' as const,
            secret,
            families: boundary.families,
          }
        : { status: 'invalid' as const };
    },
  };
});
vi.mock('@/lib/piggyvest/primary-wallet-inflow-dispatch', () => ({
  dispatchPrimaryWalletInflow: boundary.dispatch,
}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-intake', () => ({
  dispatchPrimaryWalletBankInboxIntake: boundary.intake,
}));
vi.mock('@/lib/piggyvest/server-intake-client', () => ({
  createPiggyvestIntakeServiceClient: boundary.legacyClient,
}));
vi.mock('@/lib/piggyvest/webhook-inbox', () => ({
  recordPiggyvestEvent: boundary.legacyRecord,
}));
vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: boundary.legacyProcess,
}));
vi.mock('@/lib/piggyvest/event-quarantine', () => ({
  digestRawBody: () => 'fixture-digest',
  recordQuarantineEvent: boundary.quarantine,
}));

import { POST } from './route';

const event = {
  eventId: 'fixture-event',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'inflow_transaction',
  customer_id: 'fixture-customer',
  pvb_reference: 'fixture-pvb-reference',
  pvb_wallet: 'fixture-wallet',
  eventData: {
    id: 'fixture-data',
    customer_id: 'fixture-customer',
    destination_wallet_id: 'fixture-conduit',
    type: 'inter',
    category: 'bank_transfer_inflow',
    amount: 10000,
    currency: 'NGN',
    narration: '',
    ip_address: '',
    transaction_id: 'fixture-transaction',
    timestamp: '2026-10-07T10:00:00.000Z',
    status: 'COMPLETED',
    third_party_reference: '',
    initiator_reference: '',
    internal_reference: '',
    provider: 'fixture-bank',
    destination_wallet_balance: 10000,
    destination_wallet_ledger_balance: 10000,
    destination_transaction_balance: 10000,
    reference: 'fixture-reference',
    recipient_bank_account_number: '0123456789',
    sender_name: 'Fixture sender',
    fee: 0,
  },
};

function request(signatureValid = true) {
  const body = JSON.stringify(event);
  const signature = createHmac('sha512', 'fixture-secret')
    .update(body)
    .digest('hex');
  return new NextRequest('https://example.com/api/webhooks/piggyvest', {
    method: 'POST',
    body,
    headers: {
      'x-pvb-signature': signatureValid ? signature : '0'.repeat(128),
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  boundary.families = ['bank'];
  boundary.intake.mockResolvedValue({ outcome: 'disabled', response: null });
  boundary.legacyRecord.mockResolvedValue('recorded');
  boundary.legacyProcess.mockResolvedValue('processed');
});

it.each([
  'accepted',
  'duplicate',
  'conflict',
])('durably queues %s bank delivery without immediate credit or legacy processing', async (outcome) => {
  boundary.intake.mockResolvedValue({
    outcome,
    response: Response.json({
      received: true,
      bankQueued: outcome !== 'conflict',
    }),
  });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    received: true,
    bankQueued: outcome !== 'conflict',
  });
  expect(boundary.intake).toHaveBeenCalledWith({
    rawBody: expect.any(Buffer),
    signature: expect.any(String),
  });
  expect(boundary.dispatch).not.toHaveBeenCalled();
  expect(boundary.legacyClient).not.toHaveBeenCalled();
});

it('requests redelivery when durable bank inbox storage is unavailable', async () => {
  boundary.intake.mockResolvedValue({
    outcome: 'unavailable',
    response: Response.json(
      { code: 'PRIMARY_BANK_INBOX_UNAVAILABLE' },
      { status: 503 }
    ),
  });
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(boundary.dispatch).not.toHaveBeenCalled();
  expect(boundary.legacyClient).not.toHaveBeenCalled();
});

it('preserves unrelated legacy deposits when bank inbox attribution is not handled', async () => {
  boundary.families = ['legacy'];
  boundary.intake.mockResolvedValue({ outcome: 'not_handled', response: null });
  boundary.dispatch.mockResolvedValue('unmapped');
  expect((await POST(request())).status).toBe(200);
  expect(boundary.intake).not.toHaveBeenCalled();
  expect(boundary.legacyProcess).toHaveBeenCalledTimes(1);
});

it('skips the bank inbox for legacy-signed inflows instead of 503-looping', async () => {
  boundary.families = ['legacy'];
  // The bank inbox would 503 a legacy-signed delivery (bank keys only);
  // the route must not invoke it at all.
  boundary.intake.mockResolvedValue({
    outcome: 'unavailable',
    response: Response.json(
      { code: 'PRIMARY_BANK_INBOX_UNAVAILABLE' },
      { status: 503 }
    ),
  });
  boundary.dispatch.mockResolvedValue('unmapped');
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(boundary.intake).not.toHaveBeenCalled();
  expect(boundary.dispatch).toHaveBeenCalledTimes(1);
  expect(boundary.legacyProcess).toHaveBeenCalledTimes(1);
});

it.each([
  'credited',
  'duplicate',
])('does not credit through the legacy path after primary %s', async (outcome) => {
  boundary.dispatch.mockResolvedValue(outcome);
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    received: true,
    duplicate: outcome === 'duplicate',
  });
  expect(boundary.legacyClient).not.toHaveBeenCalled();
  expect(boundary.legacyRecord).not.toHaveBeenCalled();
  expect(boundary.legacyProcess).not.toHaveBeenCalled();
});

it('requests redelivery rather than falling back after an uncertain primary write', async () => {
  boundary.dispatch.mockRejectedValue(new Error('private database detail'));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('private');
  expect(boundary.legacyRecord).not.toHaveBeenCalled();
  expect(boundary.legacyProcess).not.toHaveBeenCalled();
});

it.each([
  'disabled',
  'unmapped',
])('preserves legacy inflow handling for %s primary attribution', async (outcome) => {
  boundary.families = ['legacy'];
  boundary.dispatch.mockResolvedValue(outcome);
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(boundary.legacyRecord).toHaveBeenCalledTimes(1);
  expect(boundary.legacyProcess).toHaveBeenCalledTimes(1);
});

it('quarantines a primary conflict without crediting either ledger', async () => {
  boundary.dispatch.mockResolvedValue('conflict');
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: true, quarantined: true });
  expect(boundary.quarantine).toHaveBeenCalledTimes(1);
  expect(boundary.legacyRecord).not.toHaveBeenCalled();
  expect(boundary.legacyProcess).not.toHaveBeenCalled();
});

it('never dispatches or legacy-processes a forged primary inflow', async () => {
  const response = await POST(request(false));
  expect(response.status).toBe(200);
  expect(boundary.dispatch).not.toHaveBeenCalled();
  expect(boundary.intake).not.toHaveBeenCalled();
  expect(boundary.legacyClient).not.toHaveBeenCalled();
  expect(boundary.legacyRecord).not.toHaveBeenCalled();
  expect(boundary.legacyProcess).not.toHaveBeenCalled();
});
