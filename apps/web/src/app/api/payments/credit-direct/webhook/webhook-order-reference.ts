export function readNoteString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseCreditDirectOrderNotes(
  notes: string | null
): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(notes || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Legacy orders may have free-text notes.
  }
  return {};
}

export function findCreditDirectWebhookOrder<
  Order extends {
    id: string;
    notes: string | null;
    payment_method: string | null;
  },
>(
  orders: readonly Order[],
  reference: string,
  metadataOrderId: string | undefined
) {
  const exactMatches = orders.filter((order) => {
    if (order.payment_method !== 'credit_direct') return false;
    const notes = parseCreditDirectOrderNotes(order.notes);
    const activeReference =
      readNoteString(notes.creditDirectTransactionId) ??
      readNoteString(notes.credit_directTransactionId) ??
      readNoteString(notes.creditDirectSessionId);
    return activeReference === reference;
  });
  // A duplicate active reference is ambiguous even with provider metadata.
  if (exactMatches.length > 1) return null;

  // Metadata can identify an unpersisted popup. The route still validates
  // the active reference or the signed unpersisted-popup case before writing.
  return exactMatches.length === 1
    ? exactMatches[0]
    : orders.find(
        (order) =>
          order.payment_method === 'credit_direct' &&
          order.id === metadataOrderId
      );
}
