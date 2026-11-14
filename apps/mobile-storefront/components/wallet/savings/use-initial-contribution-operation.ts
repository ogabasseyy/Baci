import { type SetStateAction, useState } from 'react';
import type { ContributionRail } from './stored-contribution-operation';

type OperationState = { key: string | null; rail: ContributionRail | null };

/**
 * Holds the first-contribution idempotency key together with the rail its
 * first attempt used, in one state value so the two are stored in the same
 * scope, restored together and cleared together. The rail is only valid for
 * the key it was recorded against: any change of key drops it.
 */
export function useInitialContributionOperation() {
  const [state, setState] = useState<OperationState>({
    key: null,
    rail: null,
  });
  const setKey = (action: SetStateAction<string | null>) =>
    setState((prev) => {
      const next = typeof action === 'function' ? action(prev.key) : action;
      return next === prev.key ? prev : { key: next, rail: null };
    });
  const setRail = (operationId: string, rail: ContributionRail) =>
    setState((prev) =>
      prev.key === operationId && prev.rail !== rail ? { ...prev, rail } : prev
    );
  return {
    initialContributionIdempotencyKey: state.key,
    initialContributionRail: state.rail,
    setInitialContributionIdempotencyKey: setKey,
    setInitialContributionRail: setRail,
  };
}
