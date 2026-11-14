import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';

const mocks = vi.hoisted(() => ({
  approved: vi.fn(() => false),
  invalidateQuizProductCaches: vi.fn(),
  phase: vi.fn(() => '1a'),
  resolveQuizSweepWatermarks: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/quiz/quiz-runtime-env', () => ({
  getQuizPhaseEnv: mocks.phase,
  getQuizProductionApprovedEnv: mocks.approved,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));
vi.mock('./quiz-sweep-watermarks', () => ({
  resolveQuizSweepWatermarks: mocks.resolveQuizSweepWatermarks,
}));
vi.mock('./quiz-product-cache-invalidation', () => ({
  invalidateQuizProductCaches: mocks.invalidateQuizProductCaches,
}));

import { finalizeDueQuizEvents } from './finalize-due-quiz-events';

function makeOkWatermarks(status: 'empty' | 'ok' = 'ok') {
  const floor =
    status === 'empty' ? '1970-01-01T00:00:00.000Z' : '2026-09-01T00:00:00Z';
  return {
    events: { status, floor, boundarySnapshots: new Map() },
    reservations: { status, floor, boundarySnapshots: new Map() },
    awards: { status, floor, boundarySnapshots: new Map() },
    hasProbeFailure: false,
  };
}

describe('finalizeDueQuizEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phase.mockReturnValue('1a');
    mocks.approved.mockReturnValue(false);
    mocks.resolveQuizSweepWatermarks.mockResolvedValue(makeOkWatermarks('ok'));
    mocks.invalidateQuizProductCaches.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
  });

  it('commits the runtime gate before processing the deadline lifecycle', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({
        data: {
          awarded: 0,
          liveAwaitingGate: 4,
          liveTerminalized: 4,
          liveZeroPlayerClosed: 1,
          scheduledPromoted: 2,
          testClosed: 3,
          testZeroPlayerClosed: 2,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { expired: 1, released: 1 }, error: null })
      .mockResolvedValueOnce({ data: {}, error: null });

    const result = await finalizeDueQuizEvents();

    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      'set_quiz_runtime_control_v2',
      'process_due_quiz_deadlines_v2',
      'expire_unclaimed_ranked_quiz_awards_v2',
      'close_due_product_quiz_events',
    ]);
    expect(result.body).toMatchObject({
      scheduledPromoted: 2,
      testClosed: 3,
      testZeroPlayerClosed: 2,
      liveZeroPlayerClosed: 1,
      liveTerminalized: 4,
      liveAwaitingGate: 4,
      expired: 1,
      released: 1,
      skippedLive: 4,
      failed: 0,
    });
  });

  it('reports isolated per-event deadline failures without losing batch counts', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({
        data: {
          liveTerminalizationFailed: 2,
          testClosed: 4,
          testPublicationFailed: 1,
        },
        error: null,
      })
      .mockResolvedValue({ data: {}, error: null });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      failed: 3,
      liveTerminalizationFailed: 2,
      testClosed: 4,
      testPublicationFailed: 1,
    });
  });

  it('reports isolated orchestration failures returned by the database clock', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({
        data: {
          deadlineClockFailed: 5,
          liveDeadlineClockFailed: 2,
          liveFinalizationFailed: 1,
          scheduledPromotionFailed: 1,
          testDeadlineClockFailed: 3,
        },
        error: null,
      })
      .mockResolvedValue({ data: {}, error: null });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      deadlineClockFailed: 5,
      failed: 7,
      liveDeadlineClockFailed: 2,
      liveFinalizationFailed: 1,
      scheduledPromotionFailed: 1,
      testDeadlineClockFailed: 3,
    });
  });

  it('keeps every backed-off deadline queue degraded in the direct worker', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({
        data: {
          liveAwardRetryPending: 3,
          liveTerminalizationRetryPending: 2,
          testPublicationRetryPending: 1,
        },
        error: null,
      })
      .mockResolvedValue({ data: {}, error: null });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      failed: 6,
      liveAwardRetryPending: 3,
      liveTerminalizationRetryPending: 2,
      testPublicationRetryPending: 1,
    });
  });

  it.each([
    'runtimeGateMatches',
    'runtimeGateFresh',
  ] as const)('fails the worker when the database reports %s as false', async (rejectedGate) => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({
        data: {
          runtimeGateFresh: true,
          runtimeGateMatches: true,
          [rejectedGate]: false,
        },
        error: null,
      })
      .mockResolvedValue({ data: {}, error: null });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      code: 'QUIZ_FINALIZATION_FAILED',
      failed: 1,
    });
  });

  it('passes both production gates to the live database finalizer', async () => {
    mocks.phase.mockReturnValue('production');
    mocks.approved.mockReturnValue(true);
    await finalizeDueQuizEvents();
    expect(mocks.rpc).toHaveBeenLastCalledWith('finalize_due_quiz_events');
    expect(mocks.rpc).toHaveBeenCalledWith('set_quiz_runtime_control_v2', {
      p_production_approved: true,
      p_production_phase: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('process_due_quiz_deadlines_v2', {
      p_production_approved: true,
      p_production_phase: true,
    });
  });

  it('runs independent steps after a failure and redacts all database values', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'P0001',
          details:
            'Failing row contains (customer@example.com, sk_live_secret)',
          hint: 'token=private-token',
          message: `customer@example.com token=private-token ${'x'.repeat(300)}`,
        },
      });
    const result = await finalizeDueQuizEvents();
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      code: 'QUIZ_FINALIZATION_FAILED',
      failed: 1,
    });
    expect(JSON.stringify(result.body)).not.toContain('customer@example.com');
    expect(mocks.rpc).toHaveBeenCalledTimes(4);
    expect(logger.error).toHaveBeenCalledWith({
      code: 'P0001',
      error: '[REDACTED]',
      message: 'Quiz finalization RPC failed',
      rpc: 'process_due_quiz_deadlines_v2',
    });
    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(logged).not.toContain('customer@example.com');
    expect(logged).not.toContain('private-token');
    expect(logged).not.toContain('sk_live_secret');
  });

  it('fails closed when the committed runtime-gate setter is unavailable during rollout', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', details: '', hint: '', message: '' },
      })
      .mockResolvedValue({ data: {}, error: null });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      code: 'QUIZ_FINALIZATION_FAILED',
      failed: 1,
    });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      'set_quiz_runtime_control_v2',
      'expire_unclaimed_ranked_quiz_awards_v2',
      'close_due_product_quiz_events',
    ]);
  });

  it('does not hide an internal undefined-function failure behind rollout fallback', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: '42883', details: '', hint: '', message: '' },
      })
      .mockResolvedValue({ data: {}, error: null });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(500);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      'set_quiz_runtime_control_v2',
      'process_due_quiz_deadlines_v2',
      'expire_unclaimed_ranked_quiz_awards_v2',
      'close_due_product_quiz_events',
    ]);
  });

  it('does not process deadlines when the committed runtime gate update fails', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', details: '', hint: '', message: '' },
    });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(500);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      'set_quiz_runtime_control_v2',
      'expire_unclaimed_ranked_quiz_awards_v2',
      'close_due_product_quiz_events',
    ]);
  });

  it('captures pre-RPC watermarks before RPCs and skips cache invalidation on idle populated tables', async () => {
    const callOrder: string[] = [];
    mocks.resolveQuizSweepWatermarks.mockImplementation(async () => {
      callOrder.push('resolveQuizSweepWatermarks');
      return makeOkWatermarks('ok');
    });
    mocks.rpc.mockImplementation(async (name: string) => {
      callOrder.push(name);
      if (name === 'set_quiz_runtime_control_v2') {
        return { data: { updated: true }, error: null };
      }
      if (name === 'process_due_quiz_deadlines_v2') {
        return { data: { scheduledPromoted: 0, testClosed: 0 }, error: null };
      }
      if (name === 'expire_unclaimed_ranked_quiz_awards_v2') {
        return { data: { expired: 0, released: 0 }, error: null };
      }
      return { data: 0, error: null };
    });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(200);
    expect(callOrder[0]).toBe('resolveQuizSweepWatermarks');
    expect(mocks.invalidateQuizProductCaches).not.toHaveBeenCalled();
  });

  it('skips cache invalidation on idle successfully probed empty tables', async () => {
    mocks.resolveQuizSweepWatermarks.mockResolvedValue(
      makeOkWatermarks('empty')
    );
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({ data: { scheduledPromoted: 0 }, error: null })
      .mockResolvedValueOnce({ data: { expired: 0 }, error: null })
      .mockResolvedValueOnce({ data: 0, error: null });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(200);
    expect(mocks.invalidateQuizProductCaches).not.toHaveBeenCalled();
  });

  it('overrides the idle shortcut when a watermark probe failed despite zero RPC mutation counters', async () => {
    const failedWatermarks = {
      ...makeOkWatermarks('ok'),
      awards: {
        status: 'error' as const,
        floor: '2026-09-01T00:03:00.000Z',
        boundarySnapshots: new Map(),
      },
      hasProbeFailure: true,
    };
    mocks.resolveQuizSweepWatermarks.mockResolvedValue(failedWatermarks);
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({ data: { scheduledPromoted: 0 }, error: null })
      .mockResolvedValueOnce({ data: { expired: 0 }, error: null })
      .mockResolvedValueOnce({ data: 0, error: null });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(200);
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledWith(
      expect.anything(),
      failedWatermarks
    );
  });

  it('runs cache invalidation when close_due_product_quiz_events returns a positive scalar count', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({ data: { scheduledPromoted: 0 }, error: null })
      .mockResolvedValueOnce({ data: { expired: 0 }, error: null })
      .mockResolvedValueOnce({ data: 1, error: null });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(200);
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledTimes(1);
  });

  it('runs cache invalidation when finalize_due_quiz_events returns a positive scalar count', async () => {
    mocks.phase.mockReturnValue('production');
    mocks.approved.mockReturnValue(true);
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({ data: { scheduledPromoted: 0 }, error: null })
      .mockResolvedValueOnce({ data: { expired: 0 }, error: null })
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: 1, error: null });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(200);
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['null scalar', null],
    ['negative scalar', -1],
  ])('fails closed into cache invalidation when close_due_product_quiz_events returns %s', async (_label, badPayload) => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({ data: { scheduledPromoted: 0 }, error: null })
      .mockResolvedValueOnce({ data: { expired: 0 }, error: null })
      .mockResolvedValueOnce({ data: badPayload, error: null });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(200);
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledTimes(1);
  });

  it('fails closed into cache invalidation when an object RPC returns no expected counter keys', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: { expired: 0 }, error: null })
      .mockResolvedValueOnce({ data: 0, error: null });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(200);
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['numeric', { scheduledPromoted: 0, newCounter: 5 }],
    ['boolean', { scheduledPromoted: 0, mutatedFlag: true }],
  ])('fails closed into cache invalidation when an object RPC includes an unrecognized %s key alongside zeros', async (_label, payload) => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({
        data: payload,
        error: null,
      })
      .mockResolvedValueOnce({ data: { expired: 0 }, error: null })
      .mockResolvedValueOnce({ data: 0, error: null });

    const result = await finalizeDueQuizEvents();

    expect(result.status).toBe(200);
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledTimes(1);
  });
});
