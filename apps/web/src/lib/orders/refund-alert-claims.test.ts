import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { logger } from '@/lib/logger';
import { REFUND_ALERT_RETRY_CAP } from './alert-merchant-cancellation-refund-review';
import { asSupabase, makeSupabase, order } from './refund-alert.test-support';
import { claimAlert, confirmClaim } from './refund-alert-claims';

const review = { id: 'review-1' };

describe('claimAlert', () => {
  it('inserts the first claim keyed by review id', async () => {
    const supabase = makeSupabase();
    await expect(
      claimAlert(asSupabase(supabase), review, order, null)
    ).resolves.toBe(true);
    expect(supabase.from).toHaveBeenCalledWith(
      'order_cancellation_refund_alerts'
    );
    expect(supabase.insert).toHaveBeenCalledWith({
      merchant_id: 'merchant-1',
      order_id: 'order-1',
      review_id: 'review-1',
    });
  });

  it('returns false silently on a duplicate claim', async () => {
    vi.mocked(logger.error).mockClear();
    const supabase = makeSupabase({ code: '23505' });
    await expect(
      claimAlert(asSupabase(supabase), review, order, null)
    ).resolves.toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs and returns false on any other insert error', async () => {
    vi.mocked(logger.error).mockClear();
    const supabase = makeSupabase({ code: '50000' });
    await expect(
      claimAlert(asSupabase(supabase), review, order, null)
    ).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('increments the attempt with compare-and-set on the prior count', async () => {
    const supabase = makeSupabase();
    await expect(
      claimAlert(asSupabase(supabase), review, order, { attempts: 1 })
    ).resolves.toBe(true);
    expect(supabase.insert).not.toHaveBeenCalled();
    expect(supabase.update).toHaveBeenCalledWith({
      attempts: 2,
      last_attempt_at: expect.any(String),
    });
    expect(supabase.reclaimChain.eq).toHaveBeenCalledWith(
      'review_id',
      'review-1'
    );
    expect(supabase.reclaimChain.eq).toHaveBeenCalledWith('attempts', 1);
    expect(supabase.reclaimChain.is).toHaveBeenCalledWith('confirmed_at', null);
  });

  it('returns false when the compare-and-set matches no row', async () => {
    const supabase = makeSupabase(null, []);
    await expect(
      claimAlert(asSupabase(supabase), review, order, { attempts: 1 })
    ).resolves.toBe(false);
  });

  it('keeps the retry cap at three total attempts', () => {
    expect(REFUND_ALERT_RETRY_CAP).toBe(3);
  });
});

describe('confirmClaim', () => {
  it('stamps confirmed_at for the review', async () => {
    const supabase = makeSupabase();
    await confirmClaim(asSupabase(supabase), 'review-1');
    expect(supabase.update).toHaveBeenCalledWith({
      confirmed_at: expect.any(String),
    });
    expect(supabase.confirmEq).toHaveBeenCalledWith('review_id', 'review-1');
  });

  it('logs but does not throw when the update fails', async () => {
    vi.mocked(logger.error).mockClear();
    const supabase = makeSupabase();
    supabase.confirmEq.mockResolvedValue({ error: { message: 'x' } });
    await expect(
      confirmClaim(asSupabase(supabase), 'review-1')
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
