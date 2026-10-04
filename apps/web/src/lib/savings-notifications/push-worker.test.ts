import { describe, expect, it, vi } from 'vitest';
import { processSavingsNotificationPushClaims } from './push-worker';

const claim = {
  notification_id: 'b6e3aaf8-c90e-48da-b7c5-0dc49594f0c2',
  claim_id: 'cf42e3cc-88b8-41a1-9c79-e06ee36a38d2',
  push_token: 'ExponentPushToken[private-token]',
  title: 'Savings update',
  body: 'Your goal is progressing',
  data: {
    goalId: 'fa1a0b22-eaf1-41ce-a6b6-3c14da98d901',
    merchantId: 'd512ee25-4c39-46c0-aebe-9327ca0955a6',
  },
};

describe('processSavingsNotificationPushClaims', () => {
  it('finishes the durable claim after one push attempt with scoped savings data', async () => {
    const events: string[] = [];
    const finishPush = vi.fn(async (_input) => {
      events.push('finish');
      return true;
    });
    const send = vi.fn(async (input) => {
      events.push('send');
      expect(input).toMatchObject({
        token: claim.push_token,
        channelId: 'savings',
        data: {
          type: 'savings',
          goalId: claim.data.goalId,
          notificationId: claim.notification_id,
          merchantId: claim.data.merchantId,
        },
      });
      return { outcome: 'accepted' as const, ticketId: 'ticket-1' };
    });

    const result = await processSavingsNotificationPushClaims([claim], {
      finishPush,
      send,
    });

    expect(events).toEqual(['send', 'finish']);
    expect(finishPush).toHaveBeenCalledWith({
      notificationId: claim.notification_id,
      pushToken: claim.push_token,
      claimId: claim.claim_id,
      outcome: 'accepted',
      ticketId: 'ticket-1',
    });
    expect(result).toEqual({
      accepted: 1,
      rejected: 0,
      unknown: 0,
      finishFailed: 0,
    });
  });

  it('marks a thrown delivery unknown and never retries it', async () => {
    const send = vi.fn().mockRejectedValue(new Error('network timeout'));
    const finishPush = vi.fn().mockResolvedValue(true);

    const result = await processSavingsNotificationPushClaims([claim], {
      finishPush,
      send,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(finishPush).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'unknown', ticketId: null })
    );
    expect(result.unknown).toBe(1);
  });

  it('counts a rejected Expo ticket separately from an unknown delivery', async () => {
    const result = await processSavingsNotificationPushClaims([claim], {
      finishPush: vi.fn().mockResolvedValue(true),
      send: vi.fn().mockResolvedValue({ outcome: 'rejected', ticketId: null }),
    });

    expect(result).toEqual({
      accepted: 0,
      rejected: 1,
      unknown: 0,
      finishFailed: 0,
    });
  });

  it('keeps push requests within the configured concurrency bound', async () => {
    let active = 0;
    let peakActive = 0;
    const claims = Array.from({ length: 5 }, (_, index) => ({
      ...claim,
      notification_id: `b6e3aaf8-c90e-48da-b7c5-0dc49594f0c${index}`,
    }));
    const send = vi.fn(async () => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await Promise.resolve();
      active -= 1;
      return { outcome: 'accepted' as const, ticketId: 'ticket-1' };
    });

    await processSavingsNotificationPushClaims(
      claims,
      { send, finishPush: vi.fn().mockResolvedValue(true) },
      { concurrency: 2 }
    );

    expect(peakActive).toBe(2);
    expect(send).toHaveBeenCalledTimes(5);
  });
});
