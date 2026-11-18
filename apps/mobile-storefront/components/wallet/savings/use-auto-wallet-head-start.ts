import { useEffect, useState } from 'react';
import { walletHeadStarts } from './pending-wallet-head-start';

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
  walletBalance,
  remainingAmount,
  onAddAmountChange,
  onAddSavings,
}: {
  goalId: string;
  ready: boolean;
  addAmount: string;
  /** Latest wallet balance the sheet knows, in naira. */
  walletBalance: number;
  /** What the plan still needs, in naira. */
  remainingAmount: number;
  onAddAmountChange: (value: string) => void;
  onAddSavings: () => void;
}) {
  const [waiting, setWaiting] = useState(() => walletHeadStarts.lookup(goalId));
  useEffect(() => {
    setWaiting(walletHeadStarts.lookup(goalId));
  }, [goalId]);
  const matches = waiting !== null && Number(addAmount) === waiting;
  // Re-checked on every render and again at tap time. The server still
  // refuses a transfer the wallet cannot cover; this keeps the button honest.
  const fits =
    waiting !== null && waiting <= walletBalance && waiting <= remainingAmount;
  // Keep the sheet's amount on the ticked head start only while the one-tap
  // button is in use. When it no longer fits, the normal entry shows and the
  // customer's own edits (a smaller amount) must stick.
  useEffect(() => {
    if (ready && fits && waiting !== null && Number(addAmount) !== waiting)
      onAddAmountChange(String(waiting));
  }, [ready, fits, waiting, addAmount, onAddAmountChange]);
  return {
    /** The head start still waiting for the customer's tap, or null. */
    waiting,
    /** The head start still fits the wallet and the plan. */
    fits,
    /** True once the button may start the transfer. */
    canMove: ready && matches && fits,
    /** Starts the PIN-confirmed transfer for exactly the ticked amount. */
    move: () => {
      if (!ready || !matches || !fits) return;
      // Only the tap that claims the entry starts the transfer: a second
      // press before the re-render finds it gone and does nothing.
      const claimed = walletHeadStarts.take(goalId);
      setWaiting(null);
      if (claimed !== null) onAddSavings();
    },
    /** The customer wants a different amount: show the normal entry. */
    dismiss: () => {
      walletHeadStarts.take(goalId);
      setWaiting(null);
    },
  };
}
