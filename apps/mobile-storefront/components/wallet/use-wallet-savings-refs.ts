import { useRef } from 'react';
import type { ContributionRail } from './savings/stored-contribution-operation';

/** The pending savings-contribution operation id and rail for one wallet screen. */
export function useWalletSavingsRefs() {
  const idempotencyKeyRef = useRef<string | null>(null);
  const operationRailRef = useRef<ContributionRail | null>(null);
  return { idempotencyKeyRef, operationRailRef };
}
