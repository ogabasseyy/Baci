import { describe, expect, it } from 'vitest';
import { applyProviderFailureDiagnostics } from './vtu-provider-failure-diagnostics';

describe('applyProviderFailureDiagnostics', () => {
  it('stores the error detail and response code on a failure', () => {
    const metadata: Record<string, unknown> = { provider: 'monnify' };

    applyProviderFailureDiagnostics(metadata, {
      providerErrorDetail:
        ' Monnify API error: 400 Bad Request - Insufficient funds ',
      providerResponseCode: '99',
      success: false,
    });

    expect(metadata).toEqual({
      provider: 'monnify',
      providerErrorDetail:
        'Monnify API error: 400 Bad Request - Insufficient funds',
      providerResponseCode: '99',
    });
  });

  it('clears stale diagnostics on a success', () => {
    const metadata: Record<string, unknown> = {
      providerErrorDetail: 'old',
      providerResponseCode: '99',
    };

    applyProviderFailureDiagnostics(metadata, {
      providerErrorDetail: 'ignored',
      providerResponseCode: '99',
      success: true,
    });

    expect(metadata).toEqual({});
  });

  it('clears a stale code when a new failure has none', () => {
    const metadata: Record<string, unknown> = { providerResponseCode: '99' };

    applyProviderFailureDiagnostics(metadata, {
      providerErrorDetail: 'Monnify server error: 502',
      success: false,
    });

    expect(metadata).toEqual({
      providerErrorDetail: 'Monnify server error: 502',
    });
  });
});
