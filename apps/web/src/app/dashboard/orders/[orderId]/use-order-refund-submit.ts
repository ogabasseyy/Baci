import type { MutableRefObject } from 'react';
import { apiPost } from '@/lib/api-client';
import { buildManualRefundPayload } from '@/lib/orders/build-manual-refund-payload';
import type { RefundSummary } from '@/lib/orders/refund-summary';
import { validateManualRefundInput } from '@/lib/orders/validate-manual-refund-input';

// Retry/manual submission for the refund panel, extracted so the
// panel stays under the 300-line budget. Manual records validate
// client-side first (the RPC re-validates authoritatively); both
// paths bump the polling revision so a stale refresh cannot
// clobber the just-installed summary.
export function useOrderRefundSubmit({
  amount,
  busy,
  confirmed,
  date,
  effectiveRemaining,
  method,
  note,
  orderId,
  pinnedLegId,
  reference,
  requireLeg,
  revision,
  setBusy,
  setConfirmed,
  setDate,
  setError,
  setLegId,
  setNote,
  setReference,
  setShowForm,
  setSummary,
}: {
  amount: string;
  busy: boolean;
  confirmed: boolean;
  date: string;
  effectiveRemaining: number | null;
  method: string;
  note: string;
  orderId: string;
  pinnedLegId: string | null;
  reference: string;
  requireLeg: boolean;
  revision: MutableRefObject<number>;
  setBusy: (value: boolean) => void;
  setConfirmed: (value: boolean) => void;
  setDate: (value: string) => void;
  setError: (value: string | null) => void;
  setLegId: (value: string) => void;
  setNote: (value: string) => void;
  setReference: (value: string) => void;
  setShowForm: (value: boolean) => void;
  setSummary: (value: RefundSummary) => void;
}) {
  return async function submit(action: 'retry' | 'manual') {
    if (busy) return;
    if (
      action === 'retry' &&
      !window.confirm(
        'Retry the remaining refund? Fund your Paystack balance first.'
      )
    )
      return;
    if (action === 'manual') {
      const validationError = validateManualRefundInput({
        amount,
        confirmed,
        date,
        method,
        paymentLegId: pinnedLegId,
        reference,
        remaining: effectiveRemaining,
        requirePaymentLeg: requireLeg,
      });
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    revision.current += 1;
    setBusy(true);
    setError(null);
    try {
      const payload =
        action === 'retry'
          ? { action }
          : buildManualRefundPayload({
              amount,
              confirmed,
              date,
              method,
              note,
              paymentLegId: pinnedLegId,
              reference,
            });
      const updated = await apiPost<RefundSummary>(
        `/api/orders/${encodeURIComponent(orderId)}/refund`,
        payload
      );
      setSummary(updated);
      setShowForm(false);
      setConfirmed(false);
      // Transfer-specific fields must not carry into the next record:
      // reopening the form after a partial manual would otherwise
      // resubmit the old reference and collide (or replay idempotently
      // when amount and timestamp also match).
      setReference('');
      setDate('');
      setNote('');
      setLegId('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to manage refund');
    } finally {
      revision.current += 1;
      setBusy(false);
    }
  };
}
