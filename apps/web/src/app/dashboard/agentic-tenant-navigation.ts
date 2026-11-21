/**
 * True only for the configured agentic tenant. Chat (Messages) is live there
 * alone for now; kept separate from the Santa campaign gate so the two can
 * change independently.
 */
export function isAgenticTenantVisible(
  merchantSlug: string | null | undefined,
  configuredMerchantSlug: string | null | undefined
): boolean {
  return (
    Boolean(configuredMerchantSlug) && merchantSlug === configuredMerchantSlug
  );
}
