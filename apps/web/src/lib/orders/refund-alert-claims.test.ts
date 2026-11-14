import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { logger } from '@/lib/logger';
import { asSupabase, makeSupabase, order } from './refund-alert.test-support';
import {
  claimAlert,
  confirmClaim,
  markUndeliverable,
} from './refund-alert-claims';
import { REFUND_ALERT_RETRY_CAP } from './refund-alert-constants';

const review = { id: 'review-1' };

describe('claimAlert', () => {
  it('inserts the first claim keyed by review id', async () => {
    const supabase = makeSupabase();
    await expect(
      claimAlert(asSupabase(supabase), review, order, null)
    ).resolves.toBe('claimed');
    expect(supabase.from).toHaveBeenCalledWith(
      'order_cancellation_refund_alerts'
    );
    expect(supabase.insert).toHaveBeenCalledWith({
      merchant_id: 'merchant-1',
      order_id: 'order-1',
      review_id: 'review-1',
    });
  });

  it('reports a duplicate claim silently', async () => {
    vi.mocked(logger.error).mockClear();
    const supabase = makeSupabase({ code: '23505' });
    await expect(
      claimAlert(asSupabase(supabase), review, order, null)
    ).resolves.toBe('duplicate');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs and reports an error on any other insert failure', async () => {
    vi.mocked(logger.error).mockClear();
    const supabase = makeSupabase({ code: '50000' });
    await expect(
      claimAlert(asSupabase(supabase), review, order, null)
    ).resolves.toBe('error');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: '50000' } })
    );
  });

  it('increments the attempt with compare-and-set on the prior count', async () => {
    const supabase = makeSupabase();
    await expect(
      claimAlert(asSupabase(supabase), review, order, { attempts: 1 })
    ).resolves.toBe('claimed');
    expect(supabase.insert).not.toHaveBeenCalled();
    expect(supabase.update).toHaveBeenCalledWith({
      attempts: 2,
      last_attempt_at: expect.any(String),
      undeliverable_at: null,
    });
    expect(supabase.reclaimChain.eq).toHaveBeenCalledWith(
      'review_id',
      'review-1'
    );
    expect(supabase.reclaimChain.eq).toHaveBeenCalledWith('attempts', 1);
    expect(supabase.reclaimChain.is).toHaveBeenCalledWith('confirmed_at', null);
  });

  it('reports a lost compare-and-set race as duplicate', async () => {
    const supabase = makeSupabase(null, []);
    await expect(
      claimAlert(asSupabase(supabase), review, order, { attempts: 1 })
    ).resolves.toBe('duplicate');
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

describe('markUndeliverable', () => {
  it('restores the attempt count and stamps undeliverable_at', async () => {
    const supabase = makeSupabase();
    await markUndeliverable(asSupabase(supabase), 'review-1', 0);
    expect(supabase.update).toHaveBeenCalledWith({
      attempts: 0,
      last_attempt_at: expect.any(String),
      undeliverable_at: expect.any(String),
    });
    expect(supabase.confirmEq).toHaveBeenCalledWith('review_id', 'review-1');
  });
});

describe('detached writes never reject', () => {
  it('confirmClaim swallows a thrown or rejected write', async () => {
    const supabase = makeSupabase();
    supabase.confirmEq.mockRejectedValue(new Error('aborted'));
    await expect(
      confirmClaim(asSupabase(supabase), 'review-1')
    ).resolves.toBeUndefined();
  });

  it('markUndeliverable swallows a thrown or rejected write', async () => {
    const supabase = makeSupabase();
    supabase.confirmEq.mockRejectedValue(new Error('aborted'));
    await expect(
      markUndeliverable(asSupabase(supabase), 'review-1', 0)
    ).resolves.toBeUndefined();
  });
});
