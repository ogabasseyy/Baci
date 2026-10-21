/** Keep the typed cart reply usable by clients that retain text blocks only.
 * This is authorized cart capability delivery to the calling assistant, not
 * shopper-facing copy. audience is advisory, NOT an access-control/redaction
 * boundary: the authorized host already receives this in structuredContent.
 * The host must handle both channels as sensitive. Verify actual ChatGPT
 * rendering during isolated live QA before claiming shopper non-disclosure.
 * Never put the capability in logs, widget metadata or a public URL.
 */
export function withGuestCartTranscript<
  T extends {
    content: { type: 'text'; text: string }[];
    structuredContent: Record<string, unknown>;
  },
>(result: T, options: { enabled?: boolean } = {}) {
  // Production registration leaves this off. Enabling a candidate requires
  // isolated host-rendering QA; an audience hint cannot enforce privacy.
  if (options.enabled !== true) return result;
  const keys = [
    'success', 'code', 'retryable', 'cart_token', 'version', 'cart_emptied',
    'expires_at', 'cart_expired', 'cart_full', 'cart_migrated',
    'requires_variant_selection', 'product_unavailable',
    'quota_exceeded', 'retry_after_seconds', 'product_id', 'product_url',
  ] as const;
  const continuation: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === 'cart_token' && result.structuredContent.cart_emptied === true) continue;
    if (Object.hasOwn(result.structuredContent, key)) {
      continuation[key] = result.structuredContent[key];
    }
  }
  if (Array.isArray(result.structuredContent.items)) {
    continuation.items = result.structuredContent.items.map((item: unknown) => {
      if (!item || typeof item !== 'object') return {};
      const line = item as Record<string, unknown>;
      return { product_id: line.product_id, quantity: line.quantity };
    });
  }
  return {
    ...result,
    content: [
      ...result.content,
      {
        type: 'text' as const,
        text: JSON.stringify(continuation),
        annotations: { audience: ['assistant' as const], priority: 1 },
      },
    ],
  };
}
