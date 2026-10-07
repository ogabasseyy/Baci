import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { captureFirstCardOwnerProof } from './runtime';
import { paymentProofFixture } from './runtime.fixture';

describe('private owner proof capture', () => {
  it('captures the exact bounded response bytes from the single verify request', async () => {
    const fixture = paymentProofFixture();
    const rawResponse = JSON.stringify({ status: true, data: fixture.data });
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(rawResponse));
    const result = await captureFirstCardOwnerProof({
      ...fixture,
      expectedIntent: fixture.intent,
      fetchImplementation,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation.mock.calls[0][1]?.method).toBe('GET');
    expect(result.rawResponse).toBe(rawResponse);
    expect(result.responseSha256).toBe(
      createHash('sha256').update(rawResponse).digest('hex')
    );
    expect(result.paidAt).toBe(fixture.data.paidAt);
    expect(result.collection.amountKobo).toBe(10000);
    expect(result.newPaymentStarted).toBe(false);
  });

  it.each([
    'invalid',
    '2026-10-03T13:00:00Z',
    '2026-10-02T12:59:00+00:00',
  ])('refuses an invalid or future paid timestamp: %s', async (paidAt) => {
    const fixture = paymentProofFixture();
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: { ...fixture.data, paidAt },
        })
      )
    );
    await expect(
      captureFirstCardOwnerProof({
        ...fixture,
        expectedIntent: fixture.intent,
        fetchImplementation,
      })
    ).rejects.toThrow('Owner proof payout timestamp unavailable');
  });

  it('refuses oversized provider evidence without returning authorization material', async () => {
    const fixture = paymentProofFixture();
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: fixture.data,
          padding: 'x'.repeat(65_536),
        })
      )
    );
    await expect(
      captureFirstCardOwnerProof({
        ...fixture,
        expectedIntent: fixture.intent,
        fetchImplementation,
      })
    ).rejects.toThrow('Owner payment verification unavailable');
  });

  it('refuses a partial response stream without a proof', async () => {
    const fixture = paymentProofFixture();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('stream failed'));
      },
    });
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(stream));
    await expect(
      captureFirstCardOwnerProof({
        ...fixture,
        expectedIntent: fixture.intent,
        fetchImplementation,
      })
    ).rejects.toThrow('Owner payment verification unavailable');
  });

  it('refuses redirected proof responses', async () => {
    const fixture = paymentProofFixture();
    const response = new Response(
      JSON.stringify({ status: true, data: fixture.data })
    );
    Object.defineProperty(response, 'redirected', { value: true });
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response);
    await expect(
      captureFirstCardOwnerProof({
        ...fixture,
        expectedIntent: fixture.intent,
        fetchImplementation,
      })
    ).rejects.toThrow('Owner payment verification unavailable');
  });
});
