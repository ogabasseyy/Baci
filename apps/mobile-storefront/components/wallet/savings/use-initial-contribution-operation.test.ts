import { expect, it } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useInitialContributionOperation } from './use-initial-contribution-operation';

it('keeps the rail with its key and clears both together', () => {
  const { result } = renderHook(() => useInitialContributionOperation());
  act(() => {
    result.current.setInitialContributionIdempotencyKey('op-1');
    result.current.setInitialContributionRail('op-1', 'legacy');
  });
  expect(result.current.initialContributionIdempotencyKey).toBe('op-1');
  expect(result.current.initialContributionRail).toBe('legacy');
  act(() => result.current.setInitialContributionIdempotencyKey(null));
  expect(result.current.initialContributionIdempotencyKey).toBeNull();
  expect(result.current.initialContributionRail).toBeNull();
});

it('ignores a rail written for a different id', () => {
  const { result } = renderHook(() => useInitialContributionOperation());
  act(() => result.current.setInitialContributionIdempotencyKey('op-1'));
  act(() => result.current.setInitialContributionRail('other', 'legacy'));
  expect(result.current.initialContributionRail).toBeNull();
});

it('clears the rail through a functional key update that releases the id', () => {
  const { result } = renderHook(() => useInitialContributionOperation());
  act(() => {
    result.current.setInitialContributionIdempotencyKey('op-1');
    result.current.setInitialContributionRail('op-1', 'primary');
  });
  act(() =>
    result.current.setInitialContributionIdempotencyKey((k) =>
      k === 'op-1' ? null : k
    )
  );
  expect(result.current.initialContributionRail).toBeNull();
});

it('keeps the rail when the key is set to the same value', () => {
  const { result } = renderHook(() => useInitialContributionOperation());
  act(() => {
    result.current.setInitialContributionIdempotencyKey('op-1');
    result.current.setInitialContributionRail('op-1', 'legacy');
  });
  act(() => result.current.setInitialContributionIdempotencyKey('op-1'));
  expect(result.current.initialContributionRail).toBe('legacy');
});
