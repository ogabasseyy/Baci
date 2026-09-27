export function getEmptyQuoteDiagnostics(
  providerCount: number,
  failedProviderCount: number
): {
  message: string;
  context: { failedProviderCount: number; providerCount: number };
} {
  return {
    message:
      providerCount > 0 && failedProviderCount === providerCount
        ? '[QuoteAggregator] All providers failed; no quotes available'
        : '[QuoteAggregator] No providers returned quotes',
    context: { failedProviderCount, providerCount },
  };
}
