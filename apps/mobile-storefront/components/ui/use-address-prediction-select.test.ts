import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { MutableRefObject } from 'react';
import type { PlacePrediction } from './AddressAutocomplete.types';

const mockFetchPlaceDetails = jest.fn<() => Promise<{ ok: true }>>();
const mockApplyPlaceSelection = jest.fn<() => void>();

jest.mock('./AddressAutocomplete.api', () => ({
  fetchPlaceDetails: mockFetchPlaceDetails,
}));
jest.mock('./apply-place-selection', () => ({
  applyPlaceSelection: mockApplyPlaceSelection,
}));

// Deferred require: the mocks above must initialize before the hook module
// loads, otherwise the mock factories capture uninitialized bindings.
const { usePredictionSelectHandler } =
  require('./use-address-prediction-select') as typeof import('./use-address-prediction-select');

function setup() {
  const isMountedRef = { current: true } as MutableRefObject<boolean>;
  const latestQueryRef = { current: '' } as MutableRefObject<string>;
  return {
    isMountedRef,
    latestQueryRef,
    onChangeText: jest.fn(),
    onSelect: jest.fn(),
    setInternalValue: jest.fn(),
    setIsLoading: jest.fn(),
    setPredictions: jest.fn(),
    setSessionToken: jest.fn(),
  };
}

const prediction = {
  mainText: '221B Baker Street',
  placeId: 'place-1',
  secondaryText: 'London',
} as PlacePrediction;

describe('usePredictionSelectHandler identity', () => {
  it('keeps a stable handler across unrelated re-renders', () => {
    const deps = setup();
    const { result, rerender } = renderHook(
      ({ sessionToken }: { sessionToken: string }) =>
        usePredictionSelectHandler({ ...deps, sessionToken }),
      { initialProps: { sessionToken: 'session-a' } }
    );
    const first = result.current;

    // Unrelated re-render (new props object, same values): the
    // suggestions-portal effect depends on this identity, so it must not
    // tear down and restart portal tracking.
    rerender({ sessionToken: 'session-a' });

    expect(result.current).toBe(first);
  });

  it('keeps the same handler when the session token changes', () => {
    const deps = setup();
    const { result, rerender } = renderHook(
      ({ sessionToken }: { sessionToken: string }) =>
        usePredictionSelectHandler({ ...deps, sessionToken }),
      { initialProps: { sessionToken: 'session-a' } }
    );
    const first = result.current;

    rerender({ sessionToken: 'session-b' });

    expect(result.current).toBe(first);
  });

  it('invokes the latest session token after a token change', async () => {
    mockFetchPlaceDetails.mockResolvedValue({ ok: true });
    const deps = setup();
    const { result, rerender } = renderHook(
      ({ sessionToken }: { sessionToken: string }) =>
        usePredictionSelectHandler({ ...deps, sessionToken }),
      { initialProps: { sessionToken: 'session-a' } }
    );

    rerender({ sessionToken: 'session-b' });

    await act(async () => {
      await result.current(prediction);
    });

    expect(mockFetchPlaceDetails).toHaveBeenCalledWith({
      prediction,
      sessionToken: 'session-b',
    });
    expect(mockApplyPlaceSelection).toHaveBeenCalledWith(
      expect.objectContaining({ details: { ok: true } })
    );
  });
});
