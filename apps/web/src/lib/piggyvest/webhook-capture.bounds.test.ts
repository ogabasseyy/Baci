import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import {
  captureVerifiedDelivery,
  describeDelivery,
  selectCapturedHeaders,
} from './webhook-capture';

/**
 * The database bounds optional metadata by BYTES (octet_length) and the
 * serialised headers by 8192 bytes. A multibyte identifier or header set
 * that fits in characters but not in bytes would fail the whole insert and
 * turn a verified delivery into a 503 loop. Optional metadata is omitted
 * instead; the raw body is always captured.
 */

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const captureId = '4204dc18-efb3-44d0-b9a2-1362448d4f21';

describe('describeDelivery bounds identifiers by UTF-8 bytes, like the database', () => {
  it('keeps identifiers at or under the byte limit', () => {
    const atLimit = 'é'.repeat(256); // 512 bytes
    expect(
      describeDelivery(
        encode({
          eventId: atLimit,
          eventType: 'é'.repeat(100), // 200 bytes
          eventData: { transaction_id: atLimit },
        })
      )
    ).toEqual({
      eventId: atLimit,
      eventType: 'é'.repeat(100),
      providerTransactionId: atLimit,
    });
  });

  it('omits identifiers over the byte limit even when they are under it in characters', () => {
    const description = describeDelivery(
      encode({
        eventId: 'é'.repeat(300), // 300 chars, 600 bytes
        eventType: 'é'.repeat(101), // 202 bytes
        eventData: { transaction_id: 'é'.repeat(257), id: 'fallback' },
      })
    );
    expect(description.eventId).toBeNull();
    expect(description.eventType).toBeNull();
    // The oversized transaction id falls through to the next candidate.
    expect(description.providerTransactionId).toBe('fallback');
  });

  it.each([
    ['a NUL character', 'abc\u0000def'],
    ['a lone high surrogate', 'abc\ud800def'],
    ['a lone low surrogate', 'abc\udc00def'],
  ])('omits identifiers the database cannot store (%s)', (_name, value) => {
    const description = describeDelivery(encode({ eventId: value }));
    expect(description.eventId).toBeNull();
  });

  it('keeps well-formed astral characters', () => {
    expect(describeDelivery(encode({ eventId: 'evt-😀' })).eventId).toBe(
      'evt-😀'
    );
  });
});

describe('selectCapturedHeaders stays inside the database byte budget', () => {
  const dbBytes = (headers: Record<string, string>) =>
    Buffer.byteLength(JSON.stringify(headers), 'utf8') +
    2 * Object.keys(headers).length;

  it('keeps the signature header and fits 8192 bytes even with large multibyte values', () => {
    const headers = new Headers({
      'x-pvb-signature': 'a'.repeat(128),
      'content-type': 'application/json',
      'user-agent': 'é'.repeat(512),
    });
    for (let index = 0; index < 20; index += 1) {
      headers.set(`x-pvb-extra-${index}`, 'é'.repeat(512));
    }

    const selected = selectCapturedHeaders(headers);

    expect(selected['x-pvb-signature']).toBe('a'.repeat(128));
    expect(selected['content-type']).toBe('application/json');
    expect(dbBytes(selected)).toBeLessThanOrEqual(8192);
  });

  it('is unchanged for ordinary headers', () => {
    expect(
      selectCapturedHeaders(
        new Headers({
          'content-type': 'application/json',
          'x-pvb-signature': 'ab',
        })
      )
    ).toEqual({ 'content-type': 'application/json', 'x-pvb-signature': 'ab' });
  });
});

describe('captureVerifiedDelivery always captures the raw body', () => {
  const base = {
    signature: randomBytes(64).toString('hex'),
    keyVersion: 'k-0123456789abcdef',
    keyFamilies: ['legacy'] as const,
    keyStatus: 'current' as const,
  };

  function client() {
    const rpc = vi.fn(async (_name: string, _args: unknown) => ({
      data: { outcome: 'captured', id: captureId, processingState: 'pending' },
      error: null,
    }));
    return { rpc, client: { rpc } as unknown as PiggyvestIntakeServiceClient };
  }

  it('sends oversized optional metadata as null and the full bytes regardless', async () => {
    const raw = encode({
      eventId: 'é'.repeat(300),
      eventType: 'wallet.long.success',
      eventData: { transaction_id: 'é'.repeat(300) },
    });
    const { rpc, client: db } = client();

    await expect(
      captureVerifiedDelivery(db, {
        ...base,
        rawBody: raw,
        headers: new Headers(),
      })
    ).resolves.toMatchObject({ outcome: 'captured' });

    const { p_command: command } = rpc.mock.calls[0]?.[1] as unknown as {
      p_command: Record<string, unknown>;
    };
    expect(command.eventId).toBeNull();
    expect(command.providerTransactionId).toBeNull();
    expect(command.eventType).toBe('wallet.long.success');
    expect(command.rawHex).toBe(Buffer.from(raw).toString('hex'));
  });

  it('keeps identifiers that fit the byte limit', async () => {
    const fits = 'é'.repeat(256);
    const { rpc, client: db } = client();

    await captureVerifiedDelivery(db, {
      ...base,
      rawBody: encode({ eventId: fits }),
      headers: new Headers(),
    });

    const { p_command: command } = rpc.mock.calls[0]?.[1] as unknown as {
      p_command: Record<string, unknown>;
    };
    expect(command.eventId).toBe(fits);
  });
});
