import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import {
  captureVerifiedDelivery,
  describeDelivery,
  markCaptureProcessed,
  selectCapturedHeaders,
} from './webhook-capture';

const captureId = '4204dc18-efb3-44d0-b9a2-1362448d4f21';

function clientWith(
  rpc: (
    name: string,
    args: unknown
  ) => Promise<{ data: unknown; error: unknown }>
) {
  const spy = vi.fn(rpc);
  return {
    client: { rpc: spy } as unknown as PiggyvestIntakeServiceClient,
    rpc: spy,
  };
}

const base = {
  signature: randomBytes(64).toString('hex'),
  keyVersion: 'k-0123456789abcdef',
  keyFamilies: ['legacy', 'bank'] as const,
  keyStatus: 'current' as const,
};

describe('describeDelivery', () => {
  it('extracts the routing identifiers without trusting shapes', () => {
    const body = JSON.stringify({
      eventId: 'evt-1',
      eventType: 'bank-transfer.inflow.success',
      eventData: { transaction_id: 'txn-1', id: 'other' },
    });
    expect(describeDelivery(new TextEncoder().encode(body))).toEqual({
      eventId: 'evt-1',
      eventType: 'bank-transfer.inflow.success',
      providerTransactionId: 'txn-1',
    });
  });

  it('falls back to the event data id for payouts and tolerates garbage', () => {
    expect(
      describeDelivery(
        new TextEncoder().encode(
          '{"eventId":"e","eventData":{"id":"payout-1"}}'
        )
      ).providerTransactionId
    ).toBe('payout-1');
    for (const garbage of ['', 'not json', '[]', '{"eventId":7}', 'null']) {
      expect(describeDelivery(new TextEncoder().encode(garbage))).toEqual({
        eventId: null,
        eventType: null,
        providerTransactionId: null,
      });
    }
    expect(
      describeDelivery(Uint8Array.from([0xff, 0xfe, 0x7b, 0x7d])).eventId
    ).toBeNull();
  });

  it('refuses oversized identifiers', () => {
    const body = JSON.stringify({ eventId: 'x'.repeat(513) });
    expect(describeDelivery(new TextEncoder().encode(body)).eventId).toBeNull();
  });
});

describe('selectCapturedHeaders', () => {
  it('keeps provider and diagnostic headers but never credentials', () => {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'User-Agent': 'piggyvest-webhooks/1',
      'X-PVB-Signature': 'A'.repeat(128),
      'X-PVB-Delivery-Attempt': '3',
      Authorization: 'Bearer secret',
      Cookie: 'session=secret',
      'X-Forwarded-For': '203.0.113.9',
    });
    const selected = selectCapturedHeaders(headers);
    expect(selected).toEqual({
      'content-type': 'application/json',
      'user-agent': 'piggyvest-webhooks/1',
      'x-pvb-signature': 'A'.repeat(128),
      'x-pvb-delivery-attempt': '3',
    });
  });

  it('bounds header value length and count', () => {
    const headers = new Headers({ 'user-agent': 'u'.repeat(2000) });
    for (let index = 0; index < 60; index += 1) {
      headers.set(`x-pvb-extra-${index}`, 'v');
    }
    const selected = selectCapturedHeaders(headers);
    expect(selected['user-agent']).toHaveLength(512);
    expect(Object.keys(selected).length).toBeLessThanOrEqual(24);
  });
});

describe('captureVerifiedDelivery', () => {
  it('sends the exact bytes, digest, signature and key evidence to the database', async () => {
    const raw = new TextEncoder().encode(
      ' \r\n{"eventId":"evt-1",  "eventType":"interest-accrued.success"}\n'
    );
    const { client, rpc } = clientWith(async () => ({
      data: { outcome: 'captured', id: captureId, processingState: 'pending' },
      error: null,
    }));

    const result = await captureVerifiedDelivery(client, {
      ...base,
      rawBody: raw,
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    expect(result).toEqual({
      outcome: 'captured',
      id: captureId,
      processingState: 'pending',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('capture_piggyvest_webhook_delivery', {
      p_command: {
        rawHex: Buffer.from(raw).toString('hex'),
        bodyDigest: createHash('sha256').update(raw).digest('hex'),
        signature: base.signature,
        eventId: 'evt-1',
        eventType: 'interest-accrued.success',
        providerTransactionId: null,
        headers: { 'content-type': 'application/json' },
        keyVersion: base.keyVersion,
        keyFamilies: ['legacy', 'bank'],
        keyStatus: 'current',
      },
    });
  });

  it('sends the headers as a plain allowlisted object that survives JSON serialisation', async () => {
    const { client, rpc } = clientWith(async () => ({
      data: { outcome: 'captured', id: captureId, processingState: 'pending' },
      error: null,
    }));

    await captureVerifiedDelivery(client, {
      ...base,
      rawBody: new TextEncoder().encode('{}'),
      headers: new Headers({
        'Content-Type': 'application/json',
        'X-PVB-Signature': base.signature.toUpperCase(),
        Authorization: 'Bearer secret-token',
        Cookie: 'session=secret',
        'X-Forwarded-For': '203.0.113.9',
      }),
    });

    const { p_command: command } = rpc.mock.calls[0]?.[1] as {
      p_command: { headers: unknown };
    };
    // JSON.stringify(new Headers(...)) is "{}": the payload must carry real
    // entries, not the Headers object.
    expect(command.headers).not.toBeInstanceOf(Headers);
    const wire = JSON.parse(JSON.stringify(command)).headers;
    expect(wire['x-pvb-signature']).toBe(base.signature.toUpperCase());
    expect(wire['content-type']).toBe('application/json');
    expect(Object.keys(wire).sort()).toEqual([
      'content-type',
      'x-pvb-signature',
    ]);
    expect(JSON.stringify(wire)).not.toMatch(
      /authorization|cookie|secret-token|203\.0\.113/i
    );
  });

  it('reports a duplicate with the existing row state', async () => {
    const { client } = clientWith(async () => ({
      data: {
        outcome: 'duplicate',
        id: captureId,
        processingState: 'processed',
      },
      error: null,
    }));
    await expect(
      captureVerifiedDelivery(client, {
        ...base,
        rawBody: new TextEncoder().encode('{}'),
        headers: new Headers(),
      })
    ).resolves.toMatchObject({
      outcome: 'duplicate',
      processingState: 'processed',
    });
  });

  it('throws without leaking database detail when storage fails', async () => {
    const { client } = clientWith(async () => ({
      data: null,
      error: { message: 'connection to 10.0.0.5 refused', code: '08006' },
    }));
    const failure = captureVerifiedDelivery(client, {
      ...base,
      rawBody: new TextEncoder().encode('{}'),
      headers: new Headers(),
    });
    await expect(failure).rejects.toThrow('PiggyVest webhook capture failed');
    await expect(failure).rejects.not.toThrow(/10\.0\.0\.5/);
  });

  it('refuses a response that is not a capture receipt', async () => {
    const { client } = clientWith(async () => ({
      data: { ok: true },
      error: null,
    }));
    await expect(
      captureVerifiedDelivery(client, {
        ...base,
        rawBody: new TextEncoder().encode('{}'),
        headers: new Headers(),
      })
    ).rejects.toThrow('PiggyVest webhook capture failed');
  });

  it('rejects a non-canonical signature before touching storage', async () => {
    const { client, rpc } = clientWith(async () => ({
      data: null,
      error: null,
    }));
    await expect(
      captureVerifiedDelivery(client, {
        ...base,
        signature: base.signature.toUpperCase(),
        rawBody: new TextEncoder().encode('{}'),
        headers: new Headers(),
      })
    ).rejects.toThrow('PiggyVest webhook capture failed');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('markCaptureProcessed', () => {
  it('completes the row inline with no claim token', async () => {
    const { client, rpc } = clientWith(async () => ({
      data: true,
      error: null,
    }));
    await markCaptureProcessed(client, captureId);
    expect(rpc).toHaveBeenCalledWith('resolve_piggyvest_webhook_capture', {
      p_id: captureId,
      p_claim_token: null,
      p_state: 'processed',
      p_error: null,
    });
  });

  it('never throws: the worker recovers a row left pending', async () => {
    const { client } = clientWith(async () => {
      throw new Error('socket closed');
    });
    await expect(
      markCaptureProcessed(client, captureId)
    ).resolves.toBeUndefined();
  });
});
