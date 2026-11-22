import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isQuizEdgeProvisioningConfigured,
  provisionQuizEdgeRooms,
} from './quiz-edge-provision';

describe('provisionQuizEdgeRooms', () => {
  const originalUrl = process.env.QUIZ_EDGE_WORKER_URL;
  const originalSecret = process.env.QUIZ_INTERNAL_COORDINATOR_SECRET;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.QUIZ_EDGE_WORKER_URL;
    } else {
      process.env.QUIZ_EDGE_WORKER_URL = originalUrl;
    }
    if (originalSecret === undefined) {
      delete process.env.QUIZ_INTERNAL_COORDINATOR_SECRET;
    } else {
      process.env.QUIZ_INTERNAL_COORDINATOR_SECRET = originalSecret;
    }
  });

  const validPayload = {
    roomIds: ['evt-1:room-0000', 'evt-1:room-0001'],
    config: {
      eventId: 'evt-1',
      merchantId: 'merch-1',
      mode: 'test' as const,
      contractVersion: 2 as const,
      rulesVersion: 'v2-test',
      questionCount: 1,
      timePerQuestionSeconds: 15,
      maxAttempts: 1,
      startsAtMs: 1_760_000_000_000,
      endsAtMs: 1_760_000_300_000,
      status: 'active' as const,
      slots: [
        {
          id: 'slot-1',
          slotIndex: 1,
          active: true,
          variants: [
            {
              id: 'var-1',
              slotId: 'slot-1',
              prompt: 'What is 2+2?',
              options: [
                { id: 'a', label: '4' },
                { id: 'b', label: '5' },
              ],
              answerKeyHash: 'abc123',
              active: true,
            },
          ],
        },
      ],
    },
  };

  it('fails closed when edge worker URL or coordinator secret is missing', async () => {
    delete process.env.QUIZ_EDGE_WORKER_URL;
    delete process.env.QUIZ_INTERNAL_COORDINATOR_SECRET;
    expect(isQuizEdgeProvisioningConfigured()).toBe(false);

    const rpc = vi.fn();
    const result = await provisionQuizEdgeRooms({
      eventId: 'evt-1',
      expectedRoomCount: 2,
      merchantId: 'merch-1',
      supabase: { rpc },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('QUIZ_EDGE_NOT_CONFIGURED');
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls prepare_quiz_edge_rooms_v2 and POSTs to /api/quiz/admin/init-rooms', async () => {
    process.env.QUIZ_EDGE_WORKER_URL = 'https://quiz-edge.example.com/';
    process.env.QUIZ_INTERNAL_COORDINATOR_SECRET = 'coord-secret-xyz';
    expect(isQuizEdgeProvisioningConfigured()).toBe(true);

    const rpc = vi.fn().mockResolvedValue({ data: validPayload, error: null });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, roomCount: 2 }), {
        status: 200,
      })
    );

    const result = await provisionQuizEdgeRooms({
      eventId: 'evt-1',
      expectedRoomCount: 2,
      fetchImpl: fetchMock as unknown as typeof fetch,
      merchantId: 'merch-1',
      supabase: { rpc },
    });

    expect(result).toEqual({ ok: true, roomCount: 2 });
    expect(rpc).toHaveBeenCalledWith('prepare_quiz_edge_rooms_v2', {
      p_event_id: 'evt-1',
      p_expected_room_count: 2,
      p_merchant_id: 'merch-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://quiz-edge.example.com/api/quiz/admin/init-rooms');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer coord-secret-xyz'
    );
    expect(JSON.parse(init.body as string)).toEqual(validPayload);
  });

  it('returns QUIZ_BACKEND_MODE_LOCKED when RPC raises QZ060', async () => {
    process.env.QUIZ_EDGE_WORKER_URL = 'https://quiz-edge.example.com';
    process.env.QUIZ_INTERNAL_COORDINATOR_SECRET = 'coord-secret-xyz';

    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'QZ060', message: 'quiz_backend_mode_locked' },
    });

    const result = await provisionQuizEdgeRooms({
      eventId: 'evt-1',
      expectedRoomCount: 2,
      merchantId: 'merch-1',
      supabase: { rpc },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('QUIZ_BACKEND_MODE_LOCKED');
    }
  });

  it('returns QUIZ_EDGE_INIT_ROOMS_FAILED and rolls back draft via reset_quiz_edge_rooms_draft_v2 when Worker returns non-2xx', async () => {
    process.env.QUIZ_EDGE_WORKER_URL = 'https://quiz-edge.example.com';
    process.env.QUIZ_INTERNAL_COORDINATOR_SECRET = 'coord-secret-xyz';

    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: validPayload, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    const result = await provisionQuizEdgeRooms({
      eventId: 'evt-1',
      expectedRoomCount: 2,
      fetchImpl: fetchMock as unknown as typeof fetch,
      merchantId: 'merch-1',
      supabase: { rpc },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('QUIZ_EDGE_INIT_ROOMS_FAILED');
    }
    expect(rpc).toHaveBeenNthCalledWith(2, 'reset_quiz_edge_rooms_draft_v2', {
      p_event_id: 'evt-1',
      p_merchant_id: 'merch-1',
    });
  });

  it('fails closed and rolls back when Worker returns HTTP 200 with mismatched roomCount or ok:false', async () => {
    process.env.QUIZ_EDGE_WORKER_URL = 'https://quiz-edge.example.com';
    process.env.QUIZ_INTERNAL_COORDINATOR_SECRET = 'coord-secret-xyz';

    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: validPayload, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, roomCount: 1 }), {
        status: 200,
      })
    );

    const result = await provisionQuizEdgeRooms({
      eventId: 'evt-1',
      expectedRoomCount: 2,
      fetchImpl: fetchMock as unknown as typeof fetch,
      merchantId: 'merch-1',
      supabase: { rpc },
    });

    expect(result).toMatchObject({
      code: 'QUIZ_EDGE_INIT_ROOMS_FAILED',
      ok: false,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'reset_quiz_edge_rooms_draft_v2', {
      p_event_id: 'evt-1',
      p_merchant_id: 'merch-1',
    });
  });

  it('maps QZ061, QZ003, and 22023 RPC errors to dedicated error codes', async () => {
    process.env.QUIZ_EDGE_WORKER_URL = 'https://quiz-edge.example.com';
    process.env.QUIZ_INTERNAL_COORDINATOR_SECRET = 'coord-secret-xyz';

    const notDraft = await provisionQuizEdgeRooms({
      eventId: 'evt-1',
      expectedRoomCount: 2,
      merchantId: 'merch-1',
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'QZ061', message: 'quiz_event_not_provisionable' },
        }),
      },
    });
    expect(notDraft).toMatchObject({
      code: 'QUIZ_EVENT_NOT_DRAFT',
      ok: false,
    });

    const incompletePool = await provisionQuizEdgeRooms({
      eventId: 'evt-1',
      expectedRoomCount: 2,
      merchantId: 'merch-1',
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'QZ003', message: 'quiz_question_pool_incomplete' },
        }),
      },
    });
    expect(incompletePool).toMatchObject({
      code: 'QUIZ_QUESTION_POOL_INCOMPLETE',
      ok: false,
    });

    const invalidConfig = await provisionQuizEdgeRooms({
      eventId: 'evt-1',
      expectedRoomCount: 999,
      merchantId: 'merch-1',
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: '22023', message: 'quiz_edge_room_count_invalid' },
        }),
      },
    });
    expect(invalidConfig).toMatchObject({
      code: 'QUIZ_EDGE_CONFIG_INVALID',
      ok: false,
    });
  });

  it('forwards launchConfig parameters to prepare_quiz_edge_rooms_v2', async () => {
    process.env.QUIZ_EDGE_WORKER_URL = 'https://quiz-edge.example.com';
    process.env.QUIZ_INTERNAL_COORDINATOR_SECRET = 'coord-secret-xyz';

    const rpc = vi.fn().mockResolvedValue({ data: validPayload, error: null });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, roomCount: 2 }), {
        status: 200,
      })
    );

    const result = await provisionQuizEdgeRooms({
      eventId: 'evt-1',
      expectedRoomCount: 2,
      fetchImpl: fetchMock as unknown as typeof fetch,
      launchConfig: {
        endsAt: '2026-11-22T10:05:00.000Z',
        maxAttempts: 3,
        questionCount: 1,
        rulesVersion: 'v2-test',
        startsAt: '2026-11-22T10:00:00.000Z',
        status: 'active',
        timePerQuestionSeconds: 15,
      },
      merchantId: 'merch-1',
      supabase: { rpc },
    });

    expect(result).toEqual({ ok: true, roomCount: 2 });
    expect(rpc).toHaveBeenCalledWith('prepare_quiz_edge_rooms_v2', {
      p_ends_at: '2026-11-22T10:05:00.000Z',
      p_event_id: 'evt-1',
      p_expected_room_count: 2,
      p_max_attempts: 3,
      p_merchant_id: 'merch-1',
      p_question_count: 1,
      p_rules_version: 'v2-test',
      p_starts_at: '2026-11-22T10:00:00.000Z',
      p_target_status: 'active',
      p_time_per_question_seconds: 15,
    });
  });
});
