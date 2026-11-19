import { useRef } from 'react';
import type { ContributionRail } from './savings/stored-contribution-operation';

/** The pending savings-contribution operation id, its rail, and whether this screen's own add is in flight. */
export function useWalletSavingsRefs() {
  const idempotencyKeyRef = useRef<string | null>(null);
  const operationRailRef = useRef<ContributionRail | null>(null);
  // This screen's own add is in flight (its id is not an earlier pending one).
  const submittingRef = useRef(false);
  return { idempotencyKeyRef, operationRailRef, submittingRef };
}
