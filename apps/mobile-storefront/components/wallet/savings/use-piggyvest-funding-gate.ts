import { useSyncExternalStore } from 'react';

type Binding = {
  subscribe: (listener: () => void) => () => void;
  getFundingBlocked: () => boolean;
  read: (source: unknown) => unknown;
};
const noSubscription = () => () => undefined;
const blockedSnapshot = () => true;
const unblockedSnapshot = () => false;

export function usePiggyvestFundingGate(
  binding: Binding | null | undefined,
  source: unknown
) {
  const observable =
    binding &&
    typeof binding.subscribe === 'function' &&
    typeof binding.getFundingBlocked === 'function' &&
    typeof binding.read === 'function'
      ? binding
      : null;
  const snapshot = useSyncExternalStore(
    observable?.subscribe ?? noSubscription,
    binding === undefined
      ? unblockedSnapshot
      : (observable?.getFundingBlocked ?? blockedSnapshot),
    binding === undefined ? unblockedSnapshot : blockedSnapshot
  );
  let matched = binding === undefined;
  if (observable) {
    try {
      matched = observable.read(source) != null;
    } catch {
      matched = false;
    }
  }
  function isClear() {
    if (binding === undefined) return true;
    try {
      return matched && observable?.getFundingBlocked() === false;
    } catch {
      return false;
    }
  }
  return { blocked: snapshot || !isClear(), isClear };
}
