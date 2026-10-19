import { describe, expect, it, vi } from 'vitest';

const { mockExpireProductBlogCache, mockReservationPurge } = vi.hoisted(() => ({
  mockExpireProductBlogCache: vi.fn(),
  mockReservationPurge: vi.fn(),
}));
vi.mock('@/lib/schedule-reservation-product-purge', () => ({
  scheduleReservationProductPurge: mockReservationPurge,
}));

vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: mockExpireProductBlogCache,
}));

import { launchMerchantQuizDraftV2 } from './quiz-launch-v2';

const baseInput = {
  answerKeyReview: { questions: [{ correctOptionId: 'a', position: 1 }] },
  confirmActivation: true as const,
  eventId: '11111111-1111-4111-8111-111111111111',
  maxAttempts: 10,
  mode: 'test' as const,
  rulesVersion: 'test-v1',
  timePerQuestionSeconds: 10,
  timeZone: 'Africa/Lagos',
  timing: { kind: 'immediate' as const, liveWindowSeconds: 300 },
  variantsPerQuestion: 1,
};

describe('launchMerchantQuizDraftV2', () => {
  it('persists the universal end independently of expected play time', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: baseInput.eventId,
        slug: 'quiz',
        status: 'active',
        title: 'Quiz',
      },
      error: null,
    });
    const builder = {
      eq: vi.fn(() => builder),
      maybeSingle,
      select: vi.fn(() => builder),
    };
    const update = vi.fn(() => builder);
    const result = await launchMerchantQuizDraftV2({
      input: baseInput,
      merchantId: 'merchant-1',
      now: new Date('2026-08-05T08:00:00.000Z'),
      supabase: { from: vi.fn(() => ({ update })) } as never,
    });
    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        live_window_seconds: 300,
        maximum_play_seconds: 10,
      })
    );
  });

  it('launches a live prize and reserves inventory through the atomic RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: baseInput.eventId,
        slug: 'quiz',
        status: 'active',
        title: 'Quiz',
      },
      error: null,
    });
    const result = await launchMerchantQuizDraftV2({
      input: {
        ...baseInput,
        maxAttempts: 1,
        mode: 'live',
        regulatoryCompliance: {
          basis: 'free_skill_competition',
          evidenceReference: 'COUNSEL-2026-08-05',
          jurisdiction: 'NG-LA',
        },
        rulesVersion: 'live-v1',
        timing: { kind: 'immediate', liveWindowSeconds: 60 },
        variantsPerQuestion: 3,
      },
      merchantId: 'merchant-1',
      supabase: { rpc } as never,
    });
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('launch_quiz_event_v2', {
      p_ends_at: expect.any(String),
      p_event_id: baseInput.eventId,
      p_question_count: 1,
      p_regulatory_basis: 'free_skill_competition',
      p_regulatory_evidence_ref: 'COUNSEL-2026-08-05',
      p_regulatory_jurisdiction: 'NG-LA',
      p_rules_version: 'live-v1',
      p_starts_at: expect.any(String),
      p_time_per_question_seconds: 10,
      p_time_zone: 'Africa/Lagos',
    });
    expect(mockExpireProductBlogCache).toHaveBeenCalledWith('merchant-1');
    expect(mockReservationPurge).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      sourceId: baseInput.eventId,
      source: 'quiz',
      supabase: { rpc },
    });
  });

  it('fails closed when the live prize has no reservable inventory', async () => {
    const result = await launchMerchantQuizDraftV2({
      input: {
        ...baseInput,
        maxAttempts: 1,
        mode: 'live',
        regulatoryCompliance: {
          basis: 'free_skill_competition',
          evidenceReference: 'COUNSEL-2026-08-05',
          jurisdiction: 'NG-LA',
        },
        rulesVersion: 'live-v1',
        timing: { kind: 'immediate', liveWindowSeconds: 60 },
        variantsPerQuestion: 3,
      },
      merchantId: 'merchant-1',
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'QZ044', message: 'quiz_prize_stock_exhausted' },
        }),
      } as never,
    });

    expect(result).toMatchObject({
      code: 'QUIZ_PRIZE_INVENTORY_UNAVAILABLE',
      ok: false,
    });
  });

  it('keeps a future launch scheduled with its exact universal end', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: baseInput.eventId,
        slug: 'quiz',
        status: 'scheduled',
        title: 'Quiz',
      },
      error: null,
    });
    const builder = {
      eq: vi.fn(() => builder),
      maybeSingle,
      select: vi.fn(() => builder),
    };
    const update = vi.fn(() => builder);
    await launchMerchantQuizDraftV2({
      input: {
        ...baseInput,
        timing: {
          endsAt: '2026-08-05T09:05:00.000Z',
          kind: 'scheduled',
          startsAt: '2026-08-05T09:00:00.000Z',
        },
      },
      merchantId: 'merchant-1',
      now: new Date('2026-08-05T08:00:00.000Z'),
      supabase: { from: vi.fn(() => ({ update })) } as never,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        ends_at: '2026-08-05T09:05:00.000Z',
        starts_at: '2026-08-05T09:00:00.000Z',
        status: 'scheduled',
      })
    );
  });

  it('rejects a scheduled start that is not in the future before mutating the draft', async () => {
    const from = vi.fn();
    const result = await launchMerchantQuizDraftV2({
      input: {
        ...baseInput,
        timing: {
          endsAt: '2026-08-05T08:05:00.000Z',
          kind: 'scheduled',
          startsAt: '2026-08-05T08:00:00.000Z',
        },
      },
      merchantId: 'merchant-1',
      now: new Date('2026-08-05T08:00:00.000Z'),
      supabase: { from } as never,
    });

    expect(result).toMatchObject({
      code: 'QUIZ_SCHEDULE_START_INVALID',
      ok: false,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('returns the launched event when a retry no longer matches the draft update', async () => {
    const launched = {
      id: baseInput.eventId,
      slug: 'quiz',
      status: 'active',
      title: 'Quiz',
    };
    const updateBuilder = {
      eq: vi.fn(() => updateBuilder),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      select: vi.fn(() => updateBuilder),
    };
    const lookupBuilder = {
      eq: vi.fn(() => lookupBuilder),
      in: vi.fn(() => lookupBuilder),
      maybeSingle: vi.fn().mockResolvedValue({ data: launched, error: null }),
      select: vi.fn(() => lookupBuilder),
    };
    const from = vi
      .fn()
      .mockReturnValueOnce({ update: vi.fn(() => updateBuilder) })
      .mockReturnValueOnce(lookupBuilder);

    const result = await launchMerchantQuizDraftV2({
      input: baseInput,
      merchantId: 'merchant-1',
      now: new Date('2026-08-05T08:00:00.000Z'),
      supabase: { from } as never,
    });

    expect(result).toEqual({ event: launched, ok: true });
    expect(lookupBuilder.eq).toHaveBeenCalledWith('contract_version', 2);
    expect(lookupBuilder.in).toHaveBeenCalledWith('status', [
      'active',
      'scheduled',
    ]);
  });
});
