import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { logger } from '@/lib/logger';
import { alertMerchantOfRefundReview } from './alert-merchant-cancellation-refund-review';
import {
  asSupabase,
  makeSenders,
  makeSupabase,
  merchant,
  order,
  review,
} from './refund-alert.test-support';
import type { RefundReviewAlertSenders } from './refund-alert-types';

vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
afterEach(() => vi.useRealTimers());

const failing = () =>
  makeSenders({
    sendEmail: vi.fn().mockResolvedValue({ success: false }),
    sendPush: vi.fn().mockResolvedValue({ sent: 0 }),
  });

function run(
  supabase: ReturnType<typeof makeSupabase>,
  senders: RefundReviewAlertSenders,
  extra: { deadlineMs?: number; prior?: { attempts: number } | null } = {}
) {
  return alertMerchantOfRefundReview({
    merchant,
    order,
    review,
    senders,
    supabase: asSupabase(supabase),
    ...extra,
  });
}

describe('alertMerchantOfRefundReview retries', () => {
  describe('re-driving an unconfirmed claim', () => {
    it('re-claims with compare-and-set on the attempt count', async () => {
      const supabase = makeSupabase();
      const senders = makeSenders();
      await expect(
        run(supabase, senders, { prior: { attempts: 2 } })
      ).resolves.toBe('delivered');
      expect(supabase.insert).not.toHaveBeenCalled();
      expect(supabase.update).toHaveBeenCalledWith(
        expect.objectContaining({ attempts: 3 })
      );
      expect(supabase.reclaimChain.eq).toHaveBeenCalledWith('attempts', 2);
      expect(supabase.reclaimChain.is).toHaveBeenCalledWith(
        'confirmed_at',
        null
      );
      expect(senders.sendPush).toHaveBeenCalledTimes(1);
    });

    it('skips when another worker won the re-claim', async () => {
      const senders = makeSenders();
      await expect(
        run(makeSupabase(null, []), senders, { prior: { attempts: 1 } })
      ).resolves.toBe('duplicate');
      expect(senders.sendPush).not.toHaveBeenCalled();
    });

    it('keeps the row when a retry fails, and logs a terminal error at the cap', async () => {
      const supabase = makeSupabase();
      await run(supabase, failing(), { prior: { attempts: 2 } });
      expect(supabase.del).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('abandoned'),
          reviewId: 'review-1',
        })
      );
    });
  });
});
