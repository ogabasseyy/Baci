import { describe, expect, it, vi } from 'vitest';
import { createPetrockClient } from './petrock-client';
import { createPetrockProvider } from './petrock-provider';

function clientFor(data: Record<string, unknown>) {
  return createPetrockClient({
    baseUrl: 'https://provider.example/api/reseller/v1',
    token: 'fixture-token',
    fetchImpl: vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'success',
          message: 'Order Details',
          code: 200,
          data,
        })
      )
    ),
  });
}

describe('Petrock live response regressions', () => {
  it('treats the captured supplier inability as a provider error eligible for refund', async () => {
    // Captured 2026-10-25; this response contained no device identifiers.
    const provider = createPetrockProvider({
      client: clientFor({
        quantity: 1,
        replay: 'Unable to check blacklist status.',
        status: 'rejected',
        date_completed: '2026-10-25 09:46:50',
        date: '2026-10-25 09:46:08',
      }),
    });
    const result = await provider.poll({
      checksIncluded: ['device', 'blacklistStatus'],
      identifier: '490154203237518',
      providerOrderId: 'fixture-order',
      tierName: 'Stolen Check',
    });
    expect(result).toMatchObject({
      kind: 'failure',
      status: 502,
      refundReason: 'error',
      body: { success: false, code: 'PETROCK_UNAVAILABLE' },
    });
    expect(result).not.toHaveProperty('body.data');
  });

  it('accepts a pending order whose replay is null', async () => {
    await expect(
      clientFor({ quantity: 1, status: 'in-process', replay: null }).getOrder(
        'fixture-order'
      )
    ).resolves.toMatchObject({
      ok: true,
      data: { status: 'in-process', replay: '' },
    });
  });

  it('does not report completion when success omits the result', async () => {
    await expect(
      clientFor({ quantity: 1, status: 'success' }).getOrder('fixture-order')
    ).resolves.toMatchObject({ ok: false });
  });
});
