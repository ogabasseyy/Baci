import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePersistedForm, usePersistedState } from './use-persisted-state';

describe('usePersistedState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns initial value when no stored data', () => {
    const { result } = renderHook(() => usePersistedState('test', 'default'));
    expect(result.current[0]).toBe('default');
  });

  it('reads from sessionStorage on mount', () => {
    sessionStorage.setItem('test', JSON.stringify('stored-value'));
    const { result } = renderHook(() => usePersistedState('test', 'default'));
    expect(result.current[0]).toBe('stored-value');
  });

  it('writes to sessionStorage on state change', () => {
    const { result } = renderHook(() => usePersistedState('test', 'initial'));
    act(() => result.current[1]('updated'));
    vi.advanceTimersByTime(500);
    expect(JSON.parse(sessionStorage.getItem('test') as string)).toBe(
      'updated'
    );
  });

  it('flushes a pending checkout order before payment navigation', () => {
    const { result, unmount } = renderHook(() =>
      usePersistedState('pending-order', '')
    );
    act(() => result.current[1]('order-before-redirect'));
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(JSON.parse(sessionStorage.getItem('pending-order') || 'null')).toBe(
      'order-before-redirect'
    );
    unmount();
    const restored = renderHook(() => usePersistedState('pending-order', ''));
    expect(restored.result.current[0]).toBe('order-before-redirect');
  });

  it('flushes unchecked marketing consent on navigation before debounce finishes', () => {
    const { result, unmount } = renderHook(() =>
      usePersistedForm('consent', { newsletterOptIn: true })
    );
    act(() => result.current.setValue('newsletterOptIn', false));
    unmount();
    const restored = renderHook(() =>
      usePersistedForm('consent', { newsletterOptIn: true })
    );
    expect(restored.result.current.values.newsletterOptIn).toBe(false);
  });

  it('does not resurrect a cleared pending order on unmount or pagehide', () => {
    const { result, unmount } = renderHook(() =>
      usePersistedState('pending', '')
    );
    act(() => result.current[1]('old-order'));
    act(() => result.current[2]());
    act(() => window.dispatchEvent(new Event('pagehide')));
    unmount();
    vi.advanceTimersByTime(500);
    expect(sessionStorage.getItem('pending')).toBeNull();
  });

  it('bugfix: pagehide after setState flushes the new snapshot, not a stale null', () => {
    const { result } = renderHook(() =>
      usePersistedState<string | null>('pending-order', null)
    );
    // Simulate the checkout path: sync storage write, then React setter, then
    // immediate navigation before the debounce effect rebinds flushRef.
    const snapshot = { orderId: 'order-1' };
    sessionStorage.setItem('pending-order', JSON.stringify(snapshot));
    act(() => {
      result.current[1](JSON.stringify(snapshot));
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(JSON.parse(sessionStorage.getItem('pending-order') || 'null')).toBe(
      JSON.stringify(snapshot)
    );
  });

  it('supports localStorage option', () => {
    localStorage.setItem('test', JSON.stringify('from-local'));
    const { result } = renderHook(() =>
      usePersistedState('test', 'default', { storage: 'local' })
    );
    expect(result.current[0]).toBe('from-local');
  });

  it('clear removes from storage and resets state', () => {
    sessionStorage.setItem('test', JSON.stringify('stored'));
    const { result } = renderHook(() => usePersistedState('test', 'default'));
    act(() => result.current[2]());
    expect(result.current[0]).toBe('default');
    expect(sessionStorage.getItem('test')).toBeNull();
  });
});

describe('usePersistedForm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns initial form values', () => {
    const { result } = renderHook(() =>
      usePersistedForm('form', { name: '', email: '' })
    );
    expect(result.current.values).toEqual({ name: '', email: '' });
  });

  it('setValue updates individual fields', () => {
    const { result } = renderHook(() =>
      usePersistedForm('form', { name: '', email: '' })
    );
    act(() => result.current.setValue('name', 'John'));
    expect(result.current.values.name).toBe('John');
  });

  it('setValues updates multiple fields', () => {
    const { result } = renderHook(() =>
      usePersistedForm('form', { name: '', email: '' })
    );
    act(() => result.current.setValues({ name: 'John', email: 'j@test.com' }));
    expect(result.current.values).toEqual({
      name: 'John',
      email: 'j@test.com',
    });
  });

  it('reset returns to initial values', () => {
    const { result } = renderHook(() =>
      usePersistedForm('form', { name: '', email: '' })
    );
    act(() => result.current.setValue('name', 'John'));
    act(() => result.current.reset());
    expect(result.current.values.name).toBe('');
  });
});
