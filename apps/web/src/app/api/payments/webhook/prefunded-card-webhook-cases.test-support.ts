import { createHmac } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createServiceClient } from '@/lib/supabase/service';

export function prefundedCardWebhookCases(
  post: (request: NextRequest) => Promise<Response>
) {
  describe('first-card capture isolation', () => {
    it('rejects an unsigned first-card event before deciding its routing', async () => {
      const request = new Request(
        'https://staging.ogabassey.com/api/payments/webhook',
        {
          method: 'POST',
          headers: { 'x-paystack-signature': 'invalid' },
          body: JSON.stringify({
            event: 'charge.success',
            data: { reference: 'pvb-first-test' },
          }),
        }
      );

      const response = await post(request as NextRequest);

      expect(response.status).toBe(401);
      expect(vi.mocked(createServiceClient)).not.toHaveBeenCalled();
    });

    it.each([
      { reference: 'pvb-first-11111111-1111-4111-8111-111111111111' },
      {
        reference: 'different',
        metadata: { transaction_type: 'prefunded_first_card' },
      },
      {
        reference: 'different',
        metadata: JSON.stringify({ transaction_type: 'prefunded_first_card' }),
      },
    ])('never sends a first-card capture through legacy settlement: %j', async (data) => {
      const raw = JSON.stringify({ event: 'charge.success', data });
      const signature = createHmac('sha512', 'test-paystack-secret')
        .update(raw)
        .digest('hex');
      const request = new Request(
        'https://staging.ogabassey.com/api/payments/webhook',
        {
          method: 'POST',
          headers: { 'x-paystack-signature': signature },
          body: raw,
        }
      );

      const response = await post(request as NextRequest);

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('60');
      expect(await response.json()).toEqual({
        error: 'First-card webhook reconciliation is not active',
        code: 'PREFUNDED_FIRST_CARD_WEBHOOK_UNAVAILABLE',
      });
      expect(vi.mocked(createServiceClient)).not.toHaveBeenCalled();
    });
  });
}
