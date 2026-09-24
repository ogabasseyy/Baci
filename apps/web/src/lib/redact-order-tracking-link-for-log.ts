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
