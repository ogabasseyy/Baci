/**
 * Public order-tracking destination for emailed order links (confirmation,
 * reminder). Prefers the token lookup — the only variant that needs no
 * customer email — and falls back to the order id plus email pair, which
 * the track-order page also auto-resolves. Both shapes must keep working:
 * see build-order-tracking-link.test.ts, which pins the pathname to the
 * checked-in App Router page.
 */
export function buildOrderTrackingLink(
  merchantUrl: string,
  order: { id: string; tracking_token?: string | null },
  customerEmail?: string | null
): string {
  const token =
    typeof order.tracking_token === 'string' ? order.tracking_token.trim() : '';
  if (token) {
    return `${merchantUrl}/track-order?token=${encodeURIComponent(token)}`;
  }
  const params = new URLSearchParams({ order_id: order.id });
  if (typeof customerEmail === 'string' && customerEmail.trim() !== '') {
    params.set('email', customerEmail.trim());
  }
  return `${merchantUrl}/track-order?${params.toString()}`;
}

/**
 * Log-safe form of an emailed tracking link: the query string carries the
 * tracking token (which resolves unmasked customer PII at the tracking
 * endpoint) and possibly the customer email, so logs keep only the
 * origin and path.
 */
export function redactOrderTrackingLinkForLog(link: string): string {
  const queryIndex = link.indexOf('?');
  return queryIndex === -1 ? link : `${link.slice(0, queryIndex)}?[redacted]`;
}
