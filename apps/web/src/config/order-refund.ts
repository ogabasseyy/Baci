export const orderRefundStatusLabels: Record<string, string> = {
  refunded: 'Refunded',
  pending: 'Pending',
  refund_pending: 'Refund pending',
  processing: 'Processing',
  requires_review: 'Requires review',
  queued: 'Queued',
  failed: 'Failed',
  not_started: 'Not started',
  claimed: 'Processing',
  completed: 'Refund completed',
  delivery_uncertain: 'Requires review',
  existing_state: 'Previous refund status',
  retry_requested: 'Retry requested',
  manual_recorded: 'Manual refund recorded',
  provider_confirmed: 'Refund confirmed',
  note_corrected: 'Note corrected',
};

// Ledger refund methods: metadata.method for manual rows, gateway
// otherwise. Unknown gateways fall back to the raw value at the
// call site so new providers render instead of blanking.
export const orderRefundMethodLabels: Record<string, string> = {
  paystack: 'Paystack',
  manual: 'Manual',
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  other: 'Other',
};
