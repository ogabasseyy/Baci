export function primaryWalletCardCheckoutWebhookBoundary(
  input: unknown
): Response | null {
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
  if (
    !(
      typeof reference === 'string' && /^pvb-first-primary-/i.test(reference)
    ) &&
    !(
      metadata &&
      typeof metadata === 'object' &&
      'transaction_type' in metadata &&
      metadata.transaction_type === 'primary_wallet_card_checkout'
    )
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
