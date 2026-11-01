import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { verifyPiggyvestPayloadSignature } from '@/lib/piggyvest/verify-piggyvest-payload-signature';
import { piggyvestWebhookEventSchema } from '@/schemas/piggyvest/events';
import {
  chainable,
  createRequest,
  inflowEvent,
  MATCHING_ENVELOPE,
  SECRET,
  signPayload,
} from './route.test-support';

describe('signPayload', () => {
  it('signs the exact bytes under SECRET, and no other key verifies it', () => {
    const body = JSON.stringify(inflowEvent);
    const payload = new TextEncoder().encode(body);

    expect(
      verifyPiggyvestPayloadSignature({
        payload,
        signature: signPayload(body),
        secret: SECRET,
      })
    ).toBe(true);
    expect(
      verifyPiggyvestPayloadSignature({
        payload,
        signature: signPayload(body),
        secret: `${SECRET}x`,
      })
    ).toBe(false);
  });
});

describe('createRequest', () => {
  it('builds the receiver POST with the signature header only when given', async () => {
    const signed = createRequest('{"a":1}', 'ab'.repeat(64));
    const unsigned = createRequest('{"a":1}');

    expect(signed.method).toBe('POST');
    expect(signed.headers.get('x-pvb-signature')).toBe('ab'.repeat(64));
    expect(unsigned.headers.get('x-pvb-signature')).toBeNull();
    expect(await signed.text()).toBe('{"a":1}');
  });
});

describe('inflowEvent', () => {
  it('is a bank inflow the event schema accepts', () => {
    const parsed = piggyvestWebhookEventSchema.parse(inflowEvent);

    expect(parsed.eventType).toBe('bank-transfer.inflow.success');
  });

  it('is described by MATCHING_ENVELOPE for the duplicate-verify read', () => {
    expect(MATCHING_ENVELOPE).toMatchObject({
      event_type: inflowEvent.eventType,
      customer_id: inflowEvent.customer_id,
      wallet_id: inflowEvent.pvb_wallet,
      reference: inflowEvent.pvb_reference,
    });
  });
});

describe('chainable', () => {
  it('resolves its result when awaited and exposes the upsert spy', async () => {
    const { query, upsert } = chainable({ data: [{ id: 1 }], error: null });

    expect(await (query as unknown as Promise<unknown>)).toEqual({
      data: [{ id: 1 }],
      error: null,
    });
    expect(upsert()).toBe(query);
  });

  it('answers the duplicate-verify read with the envelope it was given', async () => {
    const { query } = chainable({ data: [], error: null }, { custom: true });
    const select = (
      query.select as () => {
        eq: () => { maybeSingle: () => Promise<unknown> };
      }
    )();

    expect(await select.eq().maybeSingle()).toEqual({
      data: { custom: true },
      error: null,
    });
  });
});
