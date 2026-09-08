import { describe, expect, it } from 'vitest';
import { readPaymentResponse } from './read-payment-response';

describe('payment response failures', () => {
  it('reports an actionable error for the Cloudflare 502 HTML response', async () => {
    await expect(
      readPaymentResponse(
        new Response('<!DOCTYPE html><title>502 Bad Gateway</title>', {
          status: 502,
        })
      )
    ).rejects.toThrow(
      'Payment service is temporarily unavailable. Please try again.'
    );
  });
  it('retains a structured provider error', async () => {
    await expect(
      readPaymentResponse(
        Response.json(
          { error: 'Unable to reserve a bank account' },
          { status: 503 }
        )
      )
    ).rejects.toThrow('Unable to reserve a bank account');
  });
  it('returns a successful payload', async () => {
    await expect(
      readPaymentResponse(Response.json({ success: true }))
    ).resolves.toEqual({ success: true });
  });
});
