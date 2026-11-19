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

  describe('undeliverable re-checks', () => {
    const noChannels = () =>
      makeSenders({
        sendPush: vi.fn().mockResolvedValue({ errors: [], failed: 0, sent: 0 }),
      });
    const noEmail = { ...merchant, email: null };

    it('restores the prior attempt count instead of consuming a retry', async () => {
      const supabase = makeSupabase();
      await expect(
        alertMerchantOfRefundReview({
          merchant: noEmail,
          order,
          prior: { attempts: 1 },
          review,
          senders: noChannels(),
          supabase: asSupabase(supabase),
        })
      ).resolves.toBe('undeliverable');
      expect(supabase.update).toHaveBeenCalledWith({
        attempts: 1,
        last_attempt_at: expect.any(String),
        undeliverable_at: expect.any(String),
      });
    });

    it('does not wait unboundedly on a hung undeliverable write', async () => {
      vi.useFakeTimers();
      const supabase = makeSupabase();
      supabase.confirmEq.mockReturnValue(new Promise(() => {}));
      const pending = alertMerchantOfRefundReview({
        deadlineMs: Date.now() + 30_000,
        merchant: noEmail,
        order,
        review,
        senders: noChannels(),
        supabase: asSupabase(supabase),
      });
      await vi.advanceTimersByTimeAsync(2_500);
      await expect(pending).resolves.toBe('undeliverable');
      vi.useRealTimers();
    });
  });

  describe('claim deadlines', () => {
    it('defers by the deadline, aborts the claim and never delivers on a slow insert', async () => {
      vi.useFakeTimers();
      const supabase = makeSupabase();
      let aborted = false;
      supabase.insert.mockImplementation(
        () =>
          ({
            abortSignal: (signal: AbortSignal) => {
              signal.addEventListener('abort', () => {
                aborted = true;
              });
              return new Promise(() => {});
            },
          }) as never
      );
      const senders = makeSenders();
      const pending = alertMerchantOfRefundReview({
        deadlineMs: Date.now() + 9_000,
        merchant,
        order,
        review,
        senders,
        supabase: asSupabase(supabase),
      });
      await vi.advanceTimersByTimeAsync(9_000);
      await expect(pending).resolves.toBe('deferred');
      expect(aborted).toBe(true);
      expect(senders.sendPush).not.toHaveBeenCalled();
      expect(senders.sendEmail).not.toHaveBeenCalled();
    });

    it('defers on a slow compare-and-set re-claim without delivering', async () => {
      vi.useFakeTimers();
      const supabase = makeSupabase();
      supabase.reclaimChain.select.mockImplementation(
        () => ({ abortSignal: () => new Promise(() => {}) }) as never
      );
      const senders = makeSenders();
      const pending = alertMerchantOfRefundReview({
        deadlineMs: Date.now() + 9_000,
        merchant,
        order,
        prior: { attempts: 1 },
        review,
        senders,
        supabase: asSupabase(supabase),
      });
      await vi.advanceTimersByTimeAsync(9_000);
      await expect(pending).resolves.toBe('deferred');
      expect(senders.sendPush).not.toHaveBeenCalled();
    });
  });
});
