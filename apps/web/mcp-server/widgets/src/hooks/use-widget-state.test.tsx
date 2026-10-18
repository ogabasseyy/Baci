import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { resetWidgetHost, updateWidgetHost } from '../widget-host';
import { useWidgetState } from './use-widget-state';
afterEach(() => {
  resetWidgetHost();
  delete window.openai;
});
it('persists each queued action once without a React updater replay', () => {
  const persist = vi.fn();
  window.openai = { setWidgetState: persist };
  const updater = vi.fn((state: { count: number }) => ({
    count: state.count + 1,
  }));
  const { result } = renderHook(() => useWidgetState({ count: 0 }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    ),
  });
  act(() => {
    result.current[1](updater);
    result.current[1](updater);
  });
  expect(result.current[0]).toEqual({ count: 2 });
  expect(updater).toHaveBeenCalledTimes(2);
  expect(persist).toHaveBeenCalledTimes(2);
  expect(persist.mock.calls).toEqual([[{ count: 1 }], [{ count: 2 }]]);
  act(() => updateWidgetHost({ widgetState: { count: 10 } }));
  act(() => result.current[1](updater));
  expect(result.current[0]).toEqual({ count: 11 });
});
