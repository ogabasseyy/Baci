import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useAddressAutocompleteStatus } from './address-autocomplete-status';

it('does not report an initial failure state', () => {
  const onError = vi.fn();
  const { result } = renderHook(() => useAddressAutocompleteStatus(onError));
  expect(result.current.suggestionsFailed).toBe(false);
  expect(onError).not.toHaveBeenCalled();
});
it('reports a provider failure and recovery after an external reset', () => {
  const onError = vi.fn();
  const { result } = renderHook(() => useAddressAutocompleteStatus(onError));
  act(() => result.current.handleProviderError(true));
  expect(result.current.suggestionsFailed).toBe(true);
  expect(onError).toHaveBeenLastCalledWith(true);
  act(() => result.current.clearProviderError());
  expect(result.current.suggestionsFailed).toBe(false);
  expect(onError.mock.calls).toEqual([[true], [false]]);
});
it('reports recovery when a failure and reset occur in the same batch', () => {
  const onError = vi.fn();
  const { result } = renderHook(() => useAddressAutocompleteStatus(onError));
  act(() => {
    result.current.handleProviderError(true);
    result.current.clearProviderError();
  });
  expect(result.current.suggestionsFailed).toBe(false);
  expect(onError.mock.calls).toEqual([[true], [false]]);
});
it('does not duplicate recovery reports for explicit provider recovery', () => {
  const onError = vi.fn();
  const { result, rerender } = renderHook(
    ({ report }) => useAddressAutocompleteStatus(report),
    { initialProps: { report: onError } }
  );
  act(() => result.current.handleProviderError(true));
  act(() => result.current.handleProviderError(false));
  expect(onError.mock.calls).toEqual([[true], [false]]);
  const replacementCallback = vi.fn();
  rerender({ report: replacementCallback });
  expect(replacementCallback).not.toHaveBeenCalled();
});
