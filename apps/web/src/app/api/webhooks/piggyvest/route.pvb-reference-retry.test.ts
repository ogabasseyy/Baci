import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Delivery-pipeline regression: PiggyVest (2026-11-11) identifies a credit by
// pvb_reference; its internal transaction id may differ on a retry of the
// same event. That retry must reach processing, not be quarantined at the
// inbox before the ledger ever sees it.

const mocks = vi.hoisted(() => ({
  createIntakeClient: vi.fn(),
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

vi.mock('@/lib/piggyvest/server-intake-client', () => ({
  createPiggyvestIntakeClient: () => withCaptureRpc(mocks.createIntakeClient()),
}));

vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: (...args: unknown[]) =>
    mocks.processPiggyvestEvent(...args),
}));

import { POST } from './route';
import { withCaptureRpc } from './route.capture-test-support';
import {
  chainable,
  createRequest,
  inflowEvent,
  MATCHING_ENVELOPE,
  SECRET,
  signPayload,
} from './route.test-support';

beforeEach(() => {
  vi.stubEnv('PVB_SECRET_KEY', SECRET);
  mocks.processPiggyvestEvent.mockResolvedValue('processed');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.processPiggyvestEvent.mockReset();
});

function storedFirstDelivery() {
  return {
    ...MATCHING_ENVELOPE,
    event_details: {
      pvb_reference: inflowEvent.pvb_reference,
      transaction_id: inflowEvent.eventData.transaction_id,
    },
  };
}

describe('bugfix: same-event retry with a rotated internal transaction id', () => {
  it('processes the retry instead of quarantining it at the inbox', async () => {
    mocks.createIntakeClient.mockReturnValue({
      from: vi.fn(
        () => chainable({ data: [], error: null }, storedFirstDelivery()).query
      ),
    });
    const rawBody = JSON.stringify({
      ...inflowEvent,
      eventData: {
        ...inflowEvent.eventData,
        transaction_id: 'provider-txn-rotated-002',
      },
    });

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('quarantined');
    expect(mocks.processPiggyvestEvent).toHaveBeenCalled();
  });

  it('still quarantines a same-event retry with a different pvb_reference', async () => {
    mocks.createIntakeClient.mockReturnValue({
      from: vi.fn(
        () => chainable({ data: [], error: null }, storedFirstDelivery()).query
      ),
    });
    const rawBody = JSON.stringify({
      ...inflowEvent,
      pvb_reference: 'PVB01DIFFERENT',
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
