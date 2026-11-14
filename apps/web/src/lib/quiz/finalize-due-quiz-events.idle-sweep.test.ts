import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  finalizeDueQuizEvents,
  resetQuizSweepStateForTests,
} from './finalize-due-quiz-events';
import { saveQuizSweepBaseline } from './quiz-sweep-baseline-store';

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

describe('finalizeDueQuizEvents idle sweep gating', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetQuizSweepStateForTests();
    await saveQuizSweepBaseline({
      watermarks: makeOkWatermarks('ok'),
      hasPendingRecoverySweep: false,
    });
    mocks.phase.mockReturnValue('1a');
    mocks.approved.mockReturnValue(false);
    mocks.resolveQuizSweepWatermarks.mockResolvedValue(makeOkWatermarks('ok'));
    mocks.invalidateQuizProductCaches.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
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
    const emptyWatermarks = makeOkWatermarks('empty');
    await saveQuizSweepBaseline({
      watermarks: emptyWatermarks,
      hasPendingRecoverySweep: false,
    });
    mocks.resolveQuizSweepWatermarks.mockResolvedValue(emptyWatermarks);
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
    resetQuizSweepStateForTests();
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
