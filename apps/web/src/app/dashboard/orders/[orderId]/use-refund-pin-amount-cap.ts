import type { RefundSummary } from '@/lib/orders/refund-summary';

type RefundPinAmountCapArgs = {
  amount: string;
  legOptions: Array<{ id: string; label: string }>;
  legs: RefundSummary['legs'];
  method: string;
  pinnedLegId: string | null;
  remaining: number | null;
  setAmount: (value: string) => void;
  setLegId: (value: string) => void;
  setMethod: (value: string) => void;
};

/**
 * Caps the manual-refund amount at the pinned capture. A pinned
 * Paystack attestation cannot spill across captures, so the pinned
 * capture's outstanding (not the order remainder) is the amount
 * ceiling; same for a sole capture the RPC pins itself. Without
 * the cap the prefilled remainder submits and the RPC rejects it.
 */
export function useRefundPinAmountCap({
  amount,
  legOptions,
  legs,
  method,
  pinnedLegId,
  remaining,
  setAmount,
  setLegId,
  setMethod,
}: RefundPinAmountCapArgs) {
  const cappedLegId =
    pinnedLegId ??
    (method === 'paystack' && legOptions.length === 1
      ? (legOptions[0]?.id ?? null)
      : null);
  const cappedOutstanding =
    method === 'paystack' && cappedLegId !== null
      ? legs.find((leg) => leg.id === cappedLegId)?.outstanding
      : undefined;
  const effectiveRemaining =
    remaining === null
      ? null
      : Math.min(remaining, cappedOutstanding ?? remaining);
  // Snap an over-cap prefill when the merchant picks a capture (or
  // switches to Paystack with a sole one); a lower manual amount
  // is left alone.
  const snapAmountToCap = (cap: number) => {
    if (amount === '' || Number(amount) > cap) {
      setAmount(cap.toFixed(2));
    }
  };
  const handleLegIdChange = (value: string) => {
    setLegId(value);
    const outstanding = legs.find((leg) => leg.id === value)?.outstanding;
    if (outstanding !== undefined) {
      snapAmountToCap(outstanding);
    }
  };
  const handleMethodChange = (value: string) => {
    setMethod(value);
    setLegId('');
    if (value === 'paystack' && remaining !== null && legs.length === 1) {
      snapAmountToCap(legs[0]?.outstanding ?? remaining);
    }
  };
  return { effectiveRemaining, handleLegIdChange, handleMethodChange };
}
