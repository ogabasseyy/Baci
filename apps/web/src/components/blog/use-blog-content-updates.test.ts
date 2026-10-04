import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBlogContentUpdates } from './use-blog-content-updates';

describe('useBlogContentUpdates', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('marks a body edit immediately, before publishing its debounced content', () => {
    const onChange = vi.fn();
    const onDirty = vi.fn();
    const { result } = renderHook(() =>
      useBlogContentUpdates(onChange, onDirty)
    );
    act(() => result.current({ getHTML: () => '<p>Recent edit</p>' }));
    expect(onDirty).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(499));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledWith('<p>Recent edit</p>');
  });

  it('cancels an old editor update when its editor is replaced', () => {
    const onChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useBlogContentUpdates(onChange)
    );
    act(() => result.current({ getHTML: () => '<p>Discarded edit</p>' }));
    unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(onChange).not.toHaveBeenCalled();
  });
});
