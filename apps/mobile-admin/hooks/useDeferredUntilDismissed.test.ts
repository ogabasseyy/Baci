import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDeferredUntilDismissed } from './useDeferredUntilDismissed';

describe('useDeferredUntilDismissed', () => {
  it('holds tasks until the sheet reports it was dismissed, then runs them in order', () => {
    const { result } = renderHook(() => useDeferredUntilDismissed());
    const calls: string[] = [];

    result.current.defer(() => calls.push('success dialog'));
    result.current.defer(() => calls.push('alert'));
    expect(calls).toEqual([]);

    result.current.flush();
    expect(calls).toEqual(['success dialog', 'alert']);
  });

  it('runs each task only once', () => {
    const { result } = renderHook(() => useDeferredUntilDismissed());
    const task = vi.fn();

    result.current.defer(task);
    result.current.flush();
    result.current.flush();

    expect(task).toHaveBeenCalledOnce();
  });

  it('keeps the queue across re-renders', () => {
    const { rerender, result } = renderHook(() => useDeferredUntilDismissed());
    const task = vi.fn();

    result.current.defer(task);
    rerender();
    result.current.flush();

    expect(task).toHaveBeenCalledOnce();
  });
});
