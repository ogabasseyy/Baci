import { describe, expect, it } from 'vitest';
import { getEmptyQuoteDiagnostics } from './empty-quote-diagnostics';

describe('getEmptyQuoteDiagnostics', () => {
  it('describes fulfilled empty responses without claiming provider failure', () => {
    expect(getEmptyQuoteDiagnostics(2, 0)).toEqual({
      message: '[QuoteAggregator] No providers returned quotes',
      context: { failedProviderCount: 0, providerCount: 2 },
    });
  });

  it('reports failure only when every provider rejects', () => {
    expect(getEmptyQuoteDiagnostics(2, 2)).toEqual({
      message: '[QuoteAggregator] All providers failed; no quotes available',
      context: { failedProviderCount: 2, providerCount: 2 },
    });
  });

  it('does not claim all providers failed when none were registered', () => {
    expect(getEmptyQuoteDiagnostics(0, 0)).toEqual({
      message: '[QuoteAggregator] No providers returned quotes',
      context: { failedProviderCount: 0, providerCount: 0 },
    });
  });
});
