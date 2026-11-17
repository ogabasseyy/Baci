import { useEffect, useState } from 'react';
import {
  pendingWalletHeadStart,
  takeWalletHeadStart,
} from './pending-wallet-head-start';

/**
 * A head start the customer ticked "pay now" for when creating the plan.
 * Once the plan's savings wallet is ready the sheet offers a single
 * "Move ₦X from my wallet" button instead of the amount entry, so the
 * customer never re-enters the amount. Money only moves on that tap (then
 * the wallet PIN where required, checked server-side), never by itself.
 *
 * The remembered entry is kept until the customer taps, so a sheet that
 * closes, a wallet still loading, or an amount that needs re-prefilling
 * never drops the head start silently.
 */
export function useAutoWalletHeadStart({
  goalId,
  ready,
  addAmount,
  onAddAmountChange,
  onAddSavings,
}: {
  goalId: string;
  ready: boolean;
  addAmount: string;
  onAddAmountChange: (value: string) => void;
  onAddSavings: () => void;
}) {
  const [waiting, setWaiting] = useState(() => pendingWalletHeadStart(goalId));
  useEffect(() => {
    setWaiting(pendingWalletHeadStart(goalId));
  }, [goalId]);
  const matches = waiting !== null && Number(addAmount) === waiting;
  // Keep the sheet's amount on the head start the customer ticked.
  useEffect(() => {
    if (ready && waiting !== null && Number(addAmount) !== waiting)
      onAddAmountChange(String(waiting));
  }, [ready, waiting, addAmount, onAddAmountChange]);
  return {
    /** The head start still waiting for the customer's tap, or null. */
    waiting,
    /** True once the button may start the transfer. */
    canMove: ready && matches,
    /** Starts the PIN-confirmed transfer for exactly the ticked amount. */
    move: () => {
      if (!ready || !matches) return;
      takeWalletHeadStart(goalId);
      setWaiting(null);
      onAddSavings();
    },
    /** The customer wants a different amount: show the normal entry. */
    dismiss: () => {
      takeWalletHeadStart(goalId);
      setWaiting(null);
    },
  };
}
