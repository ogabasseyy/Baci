export function primaryWalletCardCheckoutWebhookBoundary(
  input: unknown
): Response | null {
  const root =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : null;
  const body =
    input && typeof input === 'object' && 'data' in input ? input.data : null;
  if (!body || typeof body !== 'object') return null;
  const reference = 'reference' in body ? body.reference : null;
  let metadata: unknown = 'metadata' in body ? body.metadata : null;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      metadata = null;
    }
  }
  // Reversal-shaped deliveries (original reference in transaction_reference)
  // stay retryable when the durable record is unreachable: acking them as
  // noise would lose money-out evidence on a transient.
  const event = root && typeof root.event === 'string' ? root.event : null;
  const transactionReference =
    'transaction_reference' in body ? body.transaction_reference : null;
  const isReversalShaped =
    (event === 'refund.processed' || event === 'charge.dispute.create') &&
    typeof transactionReference === 'string' &&
    /^pvb-first-primary-/i.test(transactionReference);
  if (
    !(
      typeof reference === 'string' && /^pvb-first-primary-/i.test(reference)
    ) &&
    !(
      metadata &&
      typeof metadata === 'object' &&
      'transaction_type' in metadata &&
      metadata.transaction_type === 'primary_wallet_card_checkout'
    ) &&
    !isReversalShaped
  )
    return null;
  return Response.json(
    {
      error: 'Primary card reconciliation pending',
      code: 'PRIMARY_CARD_WEBHOOK_PENDING',
    },
    {
      status: 503,
      headers: { 'cache-control': 'no-store', 'retry-after': '60' },
    }
  );
}
