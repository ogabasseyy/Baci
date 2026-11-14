import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  approved: vi.fn(() => false),
  getRedis: vi.fn<
    () => {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    } | null
  >(() => null),
  invalidateQuizProductCaches: vi.fn(),
  phase: vi.fn(() => '1a'),
  resolveQuizSweepWatermarks: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/redis', () => ({
  getRedis: mocks.getRedis,
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

describe('finalizeDueQuizEvents recovery and cold-start sweeps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQuizSweepStateForTests();
    mocks.phase.mockReturnValue('1a');
    mocks.approved.mockReturnValue(false);
    mocks.getRedis.mockReturnValue(null);
    mocks.resolveQuizSweepWatermarks.mockResolvedValue(makeOkWatermarks('ok'));
    mocks.invalidateQuizProductCaches.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
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

  it('sweeps from the last observed baseline when the DB deadline clock advances a watermark between idle ticks', async () => {
    const tick1Watermarks = makeOkWatermarks('ok');
    const tick2Watermarks = {
      ...makeOkWatermarks('ok'),
      events: {
        status: 'ok' as const,
        floor: '2026-09-01T00:00:05Z',
        boundarySnapshots: new Map([['evt-1', '{"status":"ended"}']]),
      },
    };
    const idleRpcSequence = () => {
      mocks.rpc
        .mockResolvedValueOnce({ data: { updated: true }, error: null })
        .mockResolvedValueOnce({ data: { scheduledPromoted: 0 }, error: null })
        .mockResolvedValueOnce({ data: { expired: 0 }, error: null })
        .mockResolvedValueOnce({ data: 0, error: null });
    };

    // Tick 1: cold idle baseline
    mocks.resolveQuizSweepWatermarks.mockResolvedValueOnce(tick1Watermarks);
    idleRpcSequence();
    await finalizeDueQuizEvents();
    expect(mocks.invalidateQuizProductCaches).not.toHaveBeenCalled();

    // Tick 2: DB deadline clock advanced events.floor before pre-RPC probe,
    // so worker RPCs return 0; must sweep from tick1Watermarks.
    mocks.resolveQuizSweepWatermarks.mockResolvedValueOnce(tick2Watermarks);
    idleRpcSequence();
    await finalizeDueQuizEvents();
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledWith(
      expect.anything(),
      tick1Watermarks
    );

    // Tick 3: unchanged from tick2Watermarks -> idle skip resumes.
    mocks.resolveQuizSweepWatermarks.mockResolvedValueOnce(tick2Watermarks);
    idleRpcSequence();
    await finalizeDueQuizEvents();
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledTimes(1);
  });

  it('retains the recovery baseline when cache invalidation reports incomplete delivery', async () => {
    const tick1Watermarks = makeOkWatermarks('ok');
    const tick2Watermarks = {
      ...makeOkWatermarks('ok'),
      events: {
        status: 'ok' as const,
        floor: '2026-09-01T00:00:05Z',
        boundarySnapshots: new Map([['evt-1', '{"status":"ended"}']]),
      },
    };
    const idleRpcSequence = () => {
      mocks.rpc
        .mockResolvedValueOnce({ data: { updated: true }, error: null })
        .mockResolvedValueOnce({ data: { scheduledPromoted: 0 }, error: null })
        .mockResolvedValueOnce({ data: { expired: 0 }, error: null })
        .mockResolvedValueOnce({ data: 0, error: null });
    };

    // Tick 1: baseline
    mocks.resolveQuizSweepWatermarks.mockResolvedValueOnce(tick1Watermarks);
    idleRpcSequence();
    await finalizeDueQuizEvents();
    expect(mocks.invalidateQuizProductCaches).not.toHaveBeenCalled();

    // Tick 2: external mutation triggers sweep, but sweep reports incomplete (false).
    mocks.resolveQuizSweepWatermarks.mockResolvedValueOnce(tick2Watermarks);
    mocks.invalidateQuizProductCaches.mockResolvedValueOnce(false);
    idleRpcSequence();
    await finalizeDueQuizEvents();
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQuizProductCaches).toHaveBeenLastCalledWith(
      expect.anything(),
      tick1Watermarks
    );

    // Tick 3: watermarks unchanged, but recovery is still pending -> retries from tick1Watermarks.
    mocks.resolveQuizSweepWatermarks.mockResolvedValueOnce(tick2Watermarks);
    mocks.invalidateQuizProductCaches.mockResolvedValueOnce(true);
    idleRpcSequence();
    await finalizeDueQuizEvents();
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateQuizProductCaches).toHaveBeenLastCalledWith(
      expect.anything(),
      tick1Watermarks
    );

    // Tick 4: recovery succeeded -> idle skip resumes.
    mocks.resolveQuizSweepWatermarks.mockResolvedValueOnce(tick2Watermarks);
    idleRpcSequence();
    await finalizeDueQuizEvents();
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledTimes(2);
  });

  it('persists recovery baseline on a failed first-tick sweep when no prior baseline exists', async () => {
    const tick1Watermarks = makeOkWatermarks('ok');

    // Tick 1: first-ever tick has a local mutation, but sweep fails (false).
    mocks.resolveQuizSweepWatermarks.mockResolvedValueOnce(tick1Watermarks);
    mocks.invalidateQuizProductCaches.mockResolvedValueOnce(false);
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({ data: { awarded: 1 }, error: null })
      .mockResolvedValueOnce({ data: { expired: 0 }, error: null })
      .mockResolvedValueOnce({ data: 0, error: null });

    await finalizeDueQuizEvents();
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQuizProductCaches).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        events: expect.objectContaining({
          floor: tick1Watermarks.events.floor,
        }),
      })
    );

    // Tick 2: idle RPCs, same watermarks -> retries recovery from tick1Watermarks.
    mocks.resolveQuizSweepWatermarks.mockResolvedValueOnce(tick1Watermarks);
    mocks.invalidateQuizProductCaches.mockResolvedValueOnce(true);
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({ data: { scheduledPromoted: 0 }, error: null })
      .mockResolvedValueOnce({ data: { expired: 0 }, error: null })
      .mockResolvedValueOnce({ data: 0, error: null });

    await finalizeDueQuizEvents();
    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateQuizProductCaches).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        events: expect.objectContaining({
          floor: tick1Watermarks.events.floor,
        }),
      })
    );
  });

  it('strips boundary snapshots during a cold-start sweep when no baseline exists', async () => {
    mocks.getRedis.mockReturnValue({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
    });
    const coldStartWatermarks = {
      ...makeOkWatermarks('ok'),
      events: {
        status: 'ok' as const,
        floor: '2026-09-01T00:00:05Z',
        boundarySnapshots: new Map([['evt-1', '{"status":"ended"}']]),
      },
    };
    mocks.resolveQuizSweepWatermarks.mockResolvedValueOnce(coldStartWatermarks);
    mocks.invalidateQuizProductCaches.mockResolvedValueOnce(true);
    mocks.rpc
      .mockResolvedValueOnce({ data: { updated: true }, error: null })
      .mockResolvedValueOnce({ data: { scheduledPromoted: 0 }, error: null })
      .mockResolvedValueOnce({ data: { expired: 0 }, error: null })
      .mockResolvedValueOnce({ data: 0, error: null });

    await finalizeDueQuizEvents();

    expect(mocks.invalidateQuizProductCaches).toHaveBeenCalledTimes(1);
    const passedWatermarks =
      mocks.invalidateQuizProductCaches.mock.calls[0]?.[1];
    expect(passedWatermarks.events.floor).toBe('2026-09-01T00:00:05Z');
    expect(passedWatermarks.events.boundarySnapshots.size).toBe(0);
  });
});
