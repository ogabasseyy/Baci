import { jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import {
  usePrefetchBillers,
  useVTUBillers,
  vtuBillerKeys,
} from '@/hooks/use-vtu-billers';
import { fetchWithRetry } from '@/lib/api';
import { logger } from '@/lib/logger';
import { getOxygenStagingProfile } from '@/lib/oxygen-staging-profile';

jest.mock('@/lib/oxygen-staging-profile', () => ({
  getOxygenStagingProfile: jest.fn(() => null),
}));

jest.mock('@/lib/api', () => ({
  fetchWithRetry: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockFetchWithRetry = fetchWithRetry as jest.MockedFunction<
  typeof fetchWithRetry
>;
const mockLogger = logger as jest.Mocked<typeof logger>;

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function mockFrameScheduler() {
  const frameCallbacks: FrameRequestCallback[] = [];
  const requestFrameSpy = jest
    .spyOn(globalThis, 'requestAnimationFrame')
    .mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
  const cancelFrameSpy = jest
    .spyOn(globalThis, 'cancelAnimationFrame')
    .mockImplementation(() => undefined);

  return { cancelFrameSpy, frameCallbacks, requestFrameSpy };
}

function flushFrames(frameCallbacks: FrameRequestCallback[]) {
  while (frameCallbacks.length > 0) {
    const callback = frameCallbacks.shift();
    callback?.(0);
  }
}

describe('usePrefetchBillers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getOxygenStagingProfile).mockReturnValue(null);
    jest.useFakeTimers();
    mockFetchWithRetry.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ billers: [] }),
    } as Awaited<ReturnType<typeof fetchWithRetry>>);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not schedule unsupported biller prefetches in isolated Oxygen staging', () => {
    jest
      .mocked(getOxygenStagingProfile)
      .mockReturnValue(
        {} as NonNullable<ReturnType<typeof getOxygenStagingProfile>>
      );
    const { frameCallbacks, requestFrameSpy, cancelFrameSpy } =
      mockFrameScheduler();
    const queryClient = createQueryClient();
    const { unmount } = renderHook(() => usePrefetchBillers(), {
      wrapper: createWrapper(queryClient),
    });
    flushFrames(frameCallbacks);
    jest.advanceTimersByTime(1450);
    expect(requestFrameSpy).not.toHaveBeenCalled();
    expect(mockFetchWithRetry).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
    unmount();
    queryClient.clear();
    requestFrameSpy.mockRestore();
    cancelFrameSpy.mockRestore();
  });

  it('does not request data billers from the mounted home widget in isolated Oxygen staging', () => {
    jest
      .mocked(getOxygenStagingProfile)
      .mockReturnValue(
        {} as NonNullable<ReturnType<typeof getOxygenStagingProfile>>
      );
    const queryClient = createQueryClient();
    const { result, unmount } = renderHook(() => useVTUBillers('data'), {
      wrapper: createWrapper(queryClient),
    });
    jest.advanceTimersByTime(2000);
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetchWithRetry).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
    unmount();
    queryClient.clear();
  });

  it('defers and staggers utility biller prefetches after initial frames', () => {
    const { frameCallbacks, requestFrameSpy, cancelFrameSpy } =
      mockFrameScheduler();
    const queryClient = createQueryClient();
    const { unmount } = renderHook(() => usePrefetchBillers(), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockFetchWithRetry).not.toHaveBeenCalled();

    flushFrames(frameCallbacks);
    jest.advanceTimersByTime(699);
    expect(mockFetchWithRetry).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(250);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(500);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(4);

    unmount();
    queryClient.clear();
    requestFrameSpy.mockRestore();
    cancelFrameSpy.mockRestore();
  });

  it('cancels deferred biller prefetches when the panel unmounts', () => {
    const { frameCallbacks, requestFrameSpy, cancelFrameSpy } =
      mockFrameScheduler();
    const queryClient = createQueryClient();
    const { unmount } = renderHook(() => usePrefetchBillers(), {
      wrapper: createWrapper(queryClient),
    });

    unmount();
    flushFrames(frameCallbacks);
    jest.runOnlyPendingTimers();

    expect(mockFetchWithRetry).not.toHaveBeenCalled();

    queryClient.clear();
    requestFrameSpy.mockRestore();
    cancelFrameSpy.mockRestore();
  });

  it('keeps staggered prefetch scheduling when a biller fetch rejects', async () => {
    const { frameCallbacks, requestFrameSpy, cancelFrameSpy } =
      mockFrameScheduler();
    const queryClient = createQueryClient();
    mockFetchWithRetry.mockRejectedValue(new Error('network unavailable'));

    const { unmount } = renderHook(() => usePrefetchBillers(), {
      wrapper: createWrapper(queryClient),
    });

    flushFrames(frameCallbacks);
    jest.advanceTimersByTime(1450);
    await Promise.resolve();

    expect(mockFetchWithRetry).toHaveBeenCalledTimes(4);
    expect(
      queryClient.getQueryData(vtuBillerKeys.byType('data'))
    ).toBeUndefined();

    unmount();
    queryClient.clear();
    requestFrameSpy.mockRestore();
    cancelFrameSpy.mockRestore();
  });

  it('does not log canceled prefetch requests as VTU errors', async () => {
    const { frameCallbacks, requestFrameSpy, cancelFrameSpy } =
      mockFrameScheduler();
    const queryClient = createQueryClient();
    mockFetchWithRetry.mockRejectedValue(
      new Error(
        'Request failed after 0 attempts: fetch failed: Fetch request has been canceled'
      )
    );

    const { unmount } = renderHook(() => usePrefetchBillers(), {
      wrapper: createWrapper(queryClient),
    });

    flushFrames(frameCallbacks);
    jest.advanceTimersByTime(1450);
    await Promise.resolve();

    expect(mockFetchWithRetry).toHaveBeenCalledTimes(4);
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'VTU',
      expect.stringContaining('Biller fetch canceled:')
    );

    unmount();
    queryClient.clear();
    requestFrameSpy.mockRestore();
    cancelFrameSpy.mockRestore();
  });
});
