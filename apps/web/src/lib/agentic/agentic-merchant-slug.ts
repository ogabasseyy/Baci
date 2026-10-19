import 'server-only';

function readNonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/**
 * Reads the configured chat tenant without importing the broader, credential-
 * bearing environment module into an anonymous storefront request graph.
 */
export function getConfiguredAgenticMerchantSlug(): string | undefined {
  return (
    readNonBlank(process.env.BACI_AGENTIC_MERCHANT_SLUG) ??
    readNonBlank(process.env.OPENAI_AGENTIC_MERCHANT_SLUG)
  );
}
