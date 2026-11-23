import { describe, expect, it, vi } from 'vitest';

const { mockRollbackQuizEdgeDraft } = vi.hoisted(() => ({
  mockRollbackQuizEdgeDraft: vi.fn(),
}));

vi.mock('@/lib/quiz/quiz-edge-provision', () => ({
  isQuizEdgeProvisioningConfigured: vi.fn(() => true),
  provisionQuizEdgeRooms: vi.fn(),
  rollbackQuizEdgeDraftBackendMode: mockRollbackQuizEdgeDraft,
}));

import {
  resolveAlreadyLaunchedEdgeResult,
  rollbackEdgeDraftAndAnnotateFailure,
} from './quiz-launch-edge';

describe('quiz-launch-edge', () => {
  const baseEvent = {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'quiz',
    status: 'active' as const,
    title: 'Quiz',
  };

  it('returns idempotent success when backend_mode and expected_room_count match', () => {
    expect(
      resolveAlreadyLaunchedEdgeResult(
        { ...baseEvent, backend_mode: 'edge_rooms', expected_room_count: 8 },
        8
      )
    ).toEqual({ event: baseEvent, ok: true });
  });

  it('rejects room-count drift and backend mismatches', () => {
    expect(
      resolveAlreadyLaunchedEdgeResult(
        { ...baseEvent, backend_mode: 'edge_rooms', expected_room_count: 4 },
        16
      )
    ).toMatchObject({ code: 'QUIZ_EDGE_ROOM_COUNT_LOCKED', ok: false });

    expect(
      resolveAlreadyLaunchedEdgeResult(
        { ...baseEvent, backend_mode: 'postgres', expected_room_count: null },
        4
      )
    ).toMatchObject({ code: 'QUIZ_BACKEND_MODE_LOCKED', ok: false });
  });

  it('annotates failure message when automatic draft rollback fails', async () => {
    mockRollbackQuizEdgeDraft.mockResolvedValueOnce(false);
    const result = await rollbackEdgeDraftAndAnnotateFailure({
      eventId: baseEvent.id,
      failure: {
        code: 'QUIZ_LAUNCH_FAILED',
        message: 'Launch failed.',
        ok: false,
      },
      merchantId: 'merchant-1',
      supabase: { rpc: vi.fn() } as never,
    });
    expect(result.message).toContain('Automatic Edge draft reset also failed.');
  });
});
