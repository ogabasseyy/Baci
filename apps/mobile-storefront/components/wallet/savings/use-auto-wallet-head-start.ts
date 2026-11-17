import { useEffect, useState } from 'react';
import {
  pendingWalletHeadStart,
  takeWalletHeadStart,
} from './pending-wallet-head-start';

/**
 * Starts the wallet transfer for a head start the customer ticked "pay now"
 * for when creating the plan. It fires once, only when the plan's savings
 * wallet is ready, nothing is already moving, and the prefilled amount is
 * still exactly the head start (an edited amount is left to the customer).
 * The transfer itself asks for the wallet PIN and is checked server-side.
 *
 * Returns the head start still waiting to move, or null.
 */
export function useAutoWalletHeadStart({
  goalId,
  ready,
  addAmount,
  busy,
  onAddSavings,
}: {
  goalId: string;
  ready: boolean;
  addAmount: string;
  busy: boolean;
  onAddSavings: () => void;
}): number | null {
  const [waiting, setWaiting] = useState(() => pendingWalletHeadStart(goalId));
  useEffect(() => {
    setWaiting(pendingWalletHeadStart(goalId));
  }, [goalId]);
  useEffect(() => {
    if (waiting === null || !ready || busy) return;
    const amount = takeWalletHeadStart(goalId);
    setWaiting(null);
    if (amount !== null && Number(addAmount) === amount) onAddSavings();
  }, [waiting, ready, busy, goalId, addAmount, onAddSavings]);
  return waiting;
}
