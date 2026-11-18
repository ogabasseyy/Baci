// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportJobDetail } from '@/app/dashboard/migrations/migration-types';
import { useMigrationJobPolling } from '@/app/dashboard/migrations/use-migration-job-polling';

function createMockChannel() {
  let subscribeCallback: ((status: string) => void) | undefined;
  const channel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn((cb?: (status: string) => void) => {
      subscribeCallback = cb;
      return channel;
    }),
    unsubscribe: vi.fn(),
    triggerSubscribeStatus: (status: string) => {
      subscribeCallback?.(status);
    },
  };
  return channel;
}

function createMockSupabase(channel: ReturnType<typeof createMockChannel>) {
  return {
    channel: vi.fn().mockReturnValue(channel),
    removeChannel: vi.fn(),
  };
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

function createJob(
  status: ImportJobDetail['status'],
  overrides: Partial<ImportJobDetail> = {}
): ImportJobDetail {
  return {
    id: 'job-1',
    entity_type: 'orders',
    source_platform: 'bumpa',
    status,
    original_filename: 'orders.csv',
    processed_rows: 10,
    total_rows: 100,
    summary: null,
    error: null,
    created_at: '2026-03-26T10:00:00.000Z',
    committed_at: null,
    notified_at: null,
    canCommit: false,
    canNotify: false,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('useMigrationJobPolling', () => {
  let mockChannel: ReturnType<typeof createMockChannel>;
  let mockSupabase: ReturnType<typeof createMockSupabase>;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockChannel = createMockChannel();
    mockSupabase = createMockSupabase(mockChannel);

    const { createClient } = await import('@/lib/supabase/client');
    vi.mocked(createClient).mockReturnValue(mockSupabase as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('subscribes to Realtime channel when job is in active status', () => {
    const refreshJob = vi.fn().mockResolvedValue(true);

    renderHook(() =>
      useMigrationJobPolling({
        activeFilter: 'all',
        refreshJob,
        rowsResponse: null,
        selectedJob: createJob('validating'),
        selectedJobId: 'job-1',
      })
    );

    expect(mockSupabase.channel).toHaveBeenCalledWith('import-job-job-1');
    expect(mockChannel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: 'UPDATE',
        schema: 'public',
        table: 'import_jobs',
        filter: 'id=eq.job-1',
      }),
      expect.any(Function)
    );
    expect(mockChannel.subscribe).toHaveBeenCalled();
  });

  it('does NOT subscribe when no job is selected', () => {
    const refreshJob = vi.fn().mockResolvedValue(true);

    renderHook(() =>
      useMigrationJobPolling({
        activeFilter: 'all',
        refreshJob,
        rowsResponse: null,
        selectedJob: null,
        selectedJobId: null,
      })
    );

    expect(mockSupabase.channel).not.toHaveBeenCalled();
  });

  it('does NOT subscribe when job status is inactive', () => {
    const refreshJob = vi.fn().mockResolvedValue(true);

    renderHook(() =>
      useMigrationJobPolling({
        activeFilter: 'all',
        refreshJob,
        rowsResponse: null,
        selectedJob: createJob('preview_ready'),
        selectedJobId: 'job-1',
      })
    );

    expect(mockSupabase.channel).not.toHaveBeenCalled();
  });

  it('removes Realtime channel on cleanup', () => {
    const refreshJob = vi.fn().mockResolvedValue(true);

    const { unmount } = renderHook(() =>
      useMigrationJobPolling({
        activeFilter: 'all',
        refreshJob,
        rowsResponse: null,
        selectedJob: createJob('validating'),
        selectedJobId: 'job-1',
      })
    );

    unmount();

    expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockChannel);
  });

  it('keeps a 5s polling fallback alongside Realtime', async () => {
    const refreshJob = vi.fn().mockResolvedValue(true);

    renderHook(() =>
      useMigrationJobPolling({
        activeFilter: 'all',
        refreshJob,
        rowsResponse: {
          rows: [],
          pagination: { page: 1, pageSize: 25, total: 0 },
        },
        selectedJob: createJob('validating'),
        selectedJobId: 'job-1',
      })
    );

    // Should NOT poll at 1s (old behavior)
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(refreshJob).not.toHaveBeenCalled();

    // Should poll at 5s
    await act(async () => {
      vi.advanceTimersByTime(4000);
      await Promise.resolve();
    });
    expect(refreshJob).toHaveBeenCalledTimes(1);
  });

  it('skips fallback polls while another refresh is already in flight', async () => {
    const refreshJob = vi.fn().mockResolvedValue(true);
    let refreshInFlight = true;

    renderHook(() =>
      useMigrationJobPolling({
        activeFilter: 'all',
        isRefreshInFlight: () => refreshInFlight,
        refreshJob,
        rowsResponse: {
          rows: [],
          pagination: { page: 1, pageSize: 25, total: 0 },
        },
        selectedJob: createJob('validating'),
        selectedJobId: 'job-1',
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(refreshJob).not.toHaveBeenCalled();

    refreshInFlight = false;

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(refreshJob).toHaveBeenCalledTimes(1);
  });

  it('routes Realtime payload through onRealtimeJobUpdate callback', () => {
    const refreshJob = vi.fn().mockResolvedValue(true);
    const onRealtimeJobUpdate = vi.fn();

    renderHook(() =>
      useMigrationJobPolling({
        activeFilter: 'all',
        refreshJob,
        rowsResponse: null,
        selectedJob: createJob('validating'),
        selectedJobId: 'job-1',
        onRealtimeJobUpdate,
      })
    );

    // Get the Realtime callback
    const realtimeCallback = mockChannel.on.mock.calls[0][2];
    const payload = {
      new: {
        id: 'job-1',
        status: 'validating',
        processed_rows: 500,
        total_rows: 5822,
      },
    };

    act(() => {
      realtimeCallback(payload);
    });

    expect(onRealtimeJobUpdate).toHaveBeenCalledWith(payload.new);
  });

  it('triggers refreshJob with includeRows when job transitions from active to row-fetchable', () => {
    const refreshJob = vi.fn().mockResolvedValue(true);
    const onRealtimeJobUpdate = vi.fn();

    renderHook(() =>
      useMigrationJobPolling({
        activeFilter: 'all',
        refreshJob,
        rowsResponse: null,
        selectedJob: createJob('validating'),
        selectedJobId: 'job-1',
        onRealtimeJobUpdate,
      })
    );

    // Simulate Realtime reporting terminal transition
    const realtimeCallback = mockChannel.on.mock.calls[0][2];

    act(() => {
      realtimeCallback({
        new: {
          id: 'job-1',
          status: 'preview_ready',
          processed_rows: 5822,
          total_rows: 5822,
        },
      });
    });

    // Should trigger full refresh (includeJob: true so refreshJob reads
    // the fresh status, not the stale selectedJobRef) for the terminal state
    expect(refreshJob).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        includeRows: true,
        includeJob: true,
      })
    );
  });

  it('triggers refreshJob when validating updates start exposing persisted rows', () => {
    const refreshJob = vi.fn().mockResolvedValue(true);

    renderHook(() =>
      useMigrationJobPolling({
        activeFilter: 'all',
        refreshJob,
        rowsResponse: null,
        selectedJob: createJob('validating', {
          processed_rows: 0,
          total_rows: 5822,
        }),
        selectedJobId: 'job-1',
      })
    );

    const realtimeCallback = mockChannel.on.mock.calls[0][2];

    act(() => {
      realtimeCallback({
        new: {
          id: 'job-1',
          status: 'validating',
          processed_rows: 250,
          total_rows: 5822,
        },
      });
    });

    expect(refreshJob).toHaveBeenCalledTimes(1);
    expect(refreshJob).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        background: true,
        includeRows: true,
        includeJob: true,
      })
    );
  });

  it('invalidates in-flight polls when Realtime update arrives', async () => {
    const firstRefresh = createDeferred<boolean>();
    const refreshJob = vi.fn().mockReturnValue(firstRefresh.promise);
    const onRealtimeJobUpdate = vi.fn();
    const onRefreshRequestIdBump = vi.fn();

    renderHook(() =>
      useMigrationJobPolling({
        activeFilter: 'all',
        refreshJob,
        rowsResponse: {
          rows: [],
          pagination: { page: 1, pageSize: 25, total: 0 },
        },
        selectedJob: createJob('validating'),
        selectedJobId: 'job-1',
        onRealtimeJobUpdate,
        onRefreshRequestIdBump,
      })
    );

    // Trigger fallback poll
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(refreshJob).toHaveBeenCalledTimes(1);

    // While poll is in-flight, Realtime update arrives
    const realtimeCallback = mockChannel.on.mock.calls[0][2];
    act(() => {
      realtimeCallback({
        new: {
          id: 'job-1',
          status: 'validating',
          processed_rows: 1000,
          total_rows: 5822,
        },
      });
    });

    // Should have bumped the request ID to invalidate the in-flight poll
    expect(onRefreshRequestIdBump).toHaveBeenCalled();
  });

  it('passes background: true when triggering row fetch on terminal transition', () => {
    const refreshJob = vi.fn().mockResolvedValue(true);

    renderHook(() =>
      useMigrationJobPolling({
        activeFilter: 'all',
        refreshJob,
        rowsResponse: null,
        selectedJob: createJob('validating'),
        selectedJobId: 'job-1',
      })
    );

    const realtimeCallback = mockChannel.on.mock.calls[0][2];

    act(() => {
      realtimeCallback({
        new: {
          id: 'job-1',
          status: 'preview_ready',
          processed_rows: 5822,
          total_rows: 5822,
        },
      });
    });

    expect(refreshJob).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        background: true,
        includeRows: true,
        includeJob: true,
      })
    );
  });

  it('removes channel when subscribe reports CHANNEL_ERROR', () => {
    const refreshJob = vi.fn().mockResolvedValue(true);

    renderHook(() =>
      useMigrationJobPolling({
        activeFilter: 'all',
        refreshJob,
        rowsResponse: null,
        selectedJob: createJob('validating'),
        selectedJobId: 'job-1',
      })
    );

    act(() => {
      mockChannel.triggerSubscribeStatus('CHANNEL_ERROR');
    });

    expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockChannel);
  });

  it('does not overlap polling when selected job object changes mid-poll', async () => {
    const firstRefresh = createDeferred<boolean>();
    const refreshJob = vi.fn().mockReturnValue(firstRefresh.promise);

    const { rerender } = renderHook(
      ({ selectedJob }: { selectedJob: ImportJobDetail | null }) =>
        useMigrationJobPolling({
          activeFilter: 'all',
          refreshJob,
          rowsResponse: {
            rows: [],
            pagination: { page: 1, pageSize: 25, total: 0 },
          },
          selectedJob,
          selectedJobId: 'job-1',
        }),
      {
        initialProps: { selectedJob: createJob('committing') },
      }
    );

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(refreshJob).toHaveBeenCalledTimes(1);

    rerender({
      selectedJob: {
        ...createJob('committing'),
        processed_rows: 20,
      },
    });

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    // Should still only be 1 call since first hasn't resolved
    expect(refreshJob).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstRefresh.resolve(true);
      await Promise.resolve();
    });
  });
});
