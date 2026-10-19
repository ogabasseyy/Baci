import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOG_MEDIA_TOMBSTONE_GRACE_MS } from '@/app/api/admin/blog/upload/blog-media-tombstone-constants';
import { useBlogMediaTombstoneHeartbeat } from './use-blog-media-tombstone-heartbeat';

describe('useBlogMediaTombstoneHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes leased paths on every beat', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useBlogMediaTombstoneHeartbeat({
        getPaths: () => ['platform/blog/draft.webp'],
        intervalMs: 1000,
        refresh,
      })
    );

    vi.advanceTimersByTime(3500);

    expect(refresh).toHaveBeenCalledTimes(3);
    expect(refresh).toHaveBeenCalledWith(['platform/blog/draft.webp']);
  });

  it('re-reads paths per beat and skips empty beats', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    let paths = ['platform/blog/draft.webp'];
    renderHook(() =>
      useBlogMediaTombstoneHeartbeat({
        getPaths: () => paths,
        intervalMs: 1000,
        refresh,
      })
    );

    vi.advanceTimersByTime(1000);
    paths = [];
    vi.advanceTimersByTime(2000);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps beating past the grace window without failing the draft', () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValue(undefined);
    renderHook(() =>
      useBlogMediaTombstoneHeartbeat({
        getPaths: () => ['platform/blog/draft.webp'],
        intervalMs: 1000,
        refresh,
      })
    );

    vi.advanceTimersByTime(BLOG_MEDIA_TOMBSTONE_GRACE_MS + 1000);

    expect(refresh.mock.calls.length).toBeGreaterThan(3600);
  });

  it('stops on unmount', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(() =>
      useBlogMediaTombstoneHeartbeat({
        getPaths: () => ['platform/blog/draft.webp'],
        intervalMs: 1000,
        refresh,
      })
    );

    vi.advanceTimersByTime(1000);
    hook.unmount();
    vi.advanceTimersByTime(5000);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('beats immediately when the runtime resumes', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useBlogMediaTombstoneHeartbeat({
        getPaths: () => ['platform/blog/draft.webp'],
        intervalMs: 1000,
        refresh,
      })
    );

    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('online'));

    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('beats when the tab hides and stops listeners on unmount', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(() =>
      useBlogMediaTombstoneHeartbeat({
        getPaths: () => ['platform/blog/draft.webp'],
        intervalMs: 1000,
        refresh,
      })
    );

    // The hidden transition extends the lease from the hide time so
    // a phase-old beat is never the last one before suspension.
    setVisibility('hidden');
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      setVisibility('prerender');
    }
    expect(refresh).toHaveBeenCalledTimes(1);

    hook.unmount();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('online'));

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

function setVisibility(state: string) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
}
