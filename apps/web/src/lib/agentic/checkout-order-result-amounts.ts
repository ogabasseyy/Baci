/** Amount-like guards and created-order id reads for agentic dispatch. */
export function isFiniteAmountLike(value: unknown) {
  return (
    value !== null && value !== undefined && Number.isFinite(Number(value))
  );
}

export function toFiniteAmount(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function getCreatedOrderId(data: Record<string, unknown>) {
  const order = data.order;
  if (order && typeof order === 'object' && 'id' in order) {
    const id = (order as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }

  return typeof data.id === 'string' ? data.id : undefined;
}
