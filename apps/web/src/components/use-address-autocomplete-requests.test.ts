import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAddressAutocompleteRequests } from './use-address-autocomplete-requests';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const callbacks = {
    setPredictions: vi.fn(),
    setIsOpen: vi.fn(),
    setIsLoading: vi.fn(),
  };
  const hook = renderHook(
    ({ revision }) =>
      useAddressAutocompleteRequests({
        selectionRevision: revision,
        ...callbacks,
      }),
    { initialProps: { revision: 0 } }
  );
  const pendingSearch = vi.fn();
  hook.result.current.debounceTimer.current = setTimeout(pendingSearch, 300);
  const prediction = hook.result.current.predictionRequestId.current;
  const details = hook.result.current.placeDetailsRequestId.current;
  const isCurrent = () =>
    prediction === hook.result.current.predictionRequestId.current &&
    details === hook.result.current.placeDetailsRequestId.current;
  return { ...hook, ...callbacks, pendingSearch, isCurrent };
}

it('preserves pending work when the committed address has not changed', () => {
  const hook = setup();
  hook.rerender({ revision: 0 });
  act(() => vi.advanceTimersByTime(300));
  expect(hook.pendingSearch).toHaveBeenCalledOnce();
  expect(hook.isCurrent()).toBe(true);
  expect(hook.setPredictions).not.toHaveBeenCalled();
});

it('cancels pending search and rejects prior responses after a locality change', () => {
  const hook = setup();
  hook.rerender({ revision: 1 });
  act(() => vi.advanceTimersByTime(300));
  expect(hook.pendingSearch).not.toHaveBeenCalled();
  expect(hook.isCurrent()).toBe(false);
  expect(hook.setPredictions).toHaveBeenCalledWith([]);
  expect(hook.setIsOpen).toHaveBeenCalledWith(false);
  expect(hook.setIsLoading).toHaveBeenCalledWith(false);
});

it('also invalidates requests for a controlled street replacement', () => {
  const hook = setup();
  act(() => hook.result.current.setControlledReset((revision) => revision + 1));
  act(() => vi.advanceTimersByTime(300));
  expect(hook.pendingSearch).not.toHaveBeenCalled();
  expect(hook.isCurrent()).toBe(false);
  expect(hook.setIsLoading).toHaveBeenCalledWith(false);
});

it('cancels pending search and ignores late results after unmount', () => {
  const hook = setup();
  hook.unmount();
  act(() => vi.advanceTimersByTime(300));
  expect(hook.pendingSearch).not.toHaveBeenCalled();
  expect(hook.isCurrent()).toBe(false);
});
