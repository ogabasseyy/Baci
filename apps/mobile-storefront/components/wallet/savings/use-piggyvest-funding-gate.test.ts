import { act, renderHook } from '@testing-library/react-native';
import { usePiggyvestFundingGate } from './use-piggyvest-funding-gate';

it('fails closed for null bindings and mismatched source, while omission preserves legacy', () => {
  expect(
    renderHook(() => usePiggyvestFundingGate(undefined, null)).result.current
      .blocked
  ).toBe(false);
  expect(
    renderHook(() => usePiggyvestFundingGate(null, null)).result.current.blocked
  ).toBe(true);
  expect(
    renderHook(() =>
      usePiggyvestFundingGate(
        {
          subscribe: () => () => undefined,
          getFundingBlocked: () => false,
          read: () => null,
        },
        null
      )
    ).result.current.blocked
  ).toBe(true);
});

it('reads live pending state before React rerenders and unsubscribes on replacement', () => {
  let pending = false;
  let listener: () => void = () => undefined;
  const unsubscribe = jest.fn();
  const binding = {
    subscribe: (callback: () => void) => {
      listener = callback;
      return unsubscribe;
    },
    getFundingBlocked: () => pending,
    read: () => ({ status: 'review' }),
  };
  const view = renderHook(() => usePiggyvestFundingGate(binding, {}));
  pending = true;
  expect(view.result.current.isClear()).toBe(false);
  act(() => listener());
  expect(view.result.current.blocked).toBe(true);
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
