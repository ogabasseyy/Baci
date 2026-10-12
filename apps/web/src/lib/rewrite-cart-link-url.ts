/**
 * Rewrites a processed cart-link URL, keeping only retryable stock failures
 * in the handoff params and always consuming one-shot link params.
 */
export function rewriteCartLinkUrl(
  href: string,
  guestQuantities: Map<string, number> | undefined,
  rejectedIds: string[]
): string {
  const url = new URL(href);
  if (guestQuantities && rejectedIds.length > 0) {
    // The quantities map is keyed by lowercased handoff ids while rejected
    // ids keep catalog/URL case: compare canonically or a case-variant
    // retry line drops its quantity and is silently consumed.
    const retryLines = rejectedIds
      .map((product_id) => ({
        product_id,
        quantity: guestQuantities.get(product_id.toLowerCase()),
      }))
      // A rejected id without a handoff quantity would serialize without
      // `quantity` and poison the whole retry URL; drop it instead.
      .filter(
        (line): line is { product_id: string; quantity: number } =>
          line.quantity !== undefined
      );
    // An empty survivor list must delete the param: guest_cart=[] fails the
    // min(1) handoff schema, which would drop the retry handoff entirely.
    if (retryLines.length > 0) {
      url.searchParams.set('guest_cart', JSON.stringify(retryLines));
    } else {
      url.searchParams.delete('guest_cart');
    }
    url.searchParams.delete('item_id');
    url.searchParams.delete('qty');
  } else if (rejectedIds.length > 0) {
    url.searchParams.set('item_id', rejectedIds.join(','));
  } else {
    url.searchParams.delete('item_id');
    url.searchParams.delete('qty');
  }
  // A transfer that did not originate from guest_cart (legacy item_id link
  // or unparseable handoff) must not leave a dead guest_cart value behind.
  if (!guestQuantities || rejectedIds.length === 0)
    url.searchParams.delete('guest_cart');
  url.searchParams.delete('quiz_award_id');
  url.searchParams.delete('quiz_voucher_token');
  url.searchParams.delete('variant_id');
  url.searchParams.delete('condition');
  return `${url.pathname}${url.search}${url.hash}`;
}
