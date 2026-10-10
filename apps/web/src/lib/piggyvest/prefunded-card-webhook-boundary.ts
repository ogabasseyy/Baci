function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function prefundedCardWebhookBoundary(body: unknown): Response | null {
  const data = record(record(body)?.data);
  let metadata = data?.metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      metadata = null;
    }
  }
  const reference = data?.reference;
  if (
    !(typeof reference === 'string' && /^pvb-first-/i.test(reference)) &&
    record(metadata)?.transaction_type !== 'prefunded_first_card'
  ) {
    return null;
  }

  return Response.json(
    {
      error: 'First-card webhook reconciliation is not active',
      code: 'PREFUNDED_FIRST_CARD_WEBHOOK_UNAVAILABLE',
    },
    {
      status: 503,
      headers: { 'cache-control': 'no-store', 'retry-after': '60' },
    }
  );
}
