/** Only proposes customer-controlled account UI; no model output or order IDs
 * are used to authorize a read or mutation. */
export function buildOgabasseyOrderAction(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
): 'orders' | null {
  const last = messages.at(-1);
  if (last?.role !== 'user') return null;
  const text = last.content;
  const orderSubject =
    /\b(?:my\s+(?:orders?|package)|where\s+is\s+my\s+delivery|orders?\s*(?:#|number|status)|(?:track|tracking)\s+(?:my\s+)?(?:order|package|delivery)|(?:cancel|cancellation)\s+(?:my\s+|the\s+)?orders?)\b/i;
  const paymentSubject =
    /\b(?:my\s+payment|payment\s+status|(?:sent|made|completed)\s+(?:my\s+|the\s+)?payment|i(?:['’]ve| have)?\s+paid)\b/i;
  if (orderSubject.test(text) || paymentSubject.test(text)) return 'orders';

  // Only a customer-supplied earlier request can supply referential context.
  // The resulting UI still requires the customer to select and confirm an order.
  if (
    /\b(?:cancel|track|status|payment)\b.{0,30}\b(?:it|this|that|them)\b/i.test(
      text
    )
  ) {
    const previousUsers = messages
      .filter((message) => message.role === 'user')
      .slice(-3, -1);
    if (
      previousUsers.some(
        (message) =>
          orderSubject.test(message.content) ||
          paymentSubject.test(message.content)
      )
    )
      return 'orders';
  }
  return null;
}
