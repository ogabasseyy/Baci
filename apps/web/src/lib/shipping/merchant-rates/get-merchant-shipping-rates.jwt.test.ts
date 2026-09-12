import { describe, expect, it, vi } from 'vitest';
import {
  getMerchantShippingRatesOrThrow,
  MerchantShippingRatesLoadError,
  type MerchantShippingRatesRpcClient,
} from './get-merchant-shipping-rates';

function clientWith(result: {
  data?: unknown;
  error?: unknown;
}): MerchantShippingRatesRpcClient {
  return {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null, ...result }),
  };
}

describe('getMerchantShippingRatesOrThrow JWT failures', () => {
  it('does not retry an authentication failure such as PGRST301', async () => {
    // Arrange — auth/JWT failures are deterministic configuration problems,
    // not transient transport errors, and must stay single-attempt.
    const supabase = clientWith({
      error: { message: 'fetch failed while decoding JWT', code: 'PGRST301' },
    });

    // Act
    const request = getMerchantShippingRatesOrThrow(supabase, 'merchant-1');

    // Assert
    await expect(request).rejects.toBeInstanceOf(
      MerchantShippingRatesLoadError
    );
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('wraps a nested PGRST301 without retrying when a transient outer code masks it', async () => {
    // Arrange — a runtime wrapper can expose a generic transport message on
    // the outer error and even attach a transient code, while PostgREST puts
    // the deterministic JWT code on its cause.
    const jwtError = Object.assign(new TypeError('fetch failed'), {
      code: 'UND_ERR_SOCKET',
      cause: { code: 'PGRST301', message: 'JWT decode failed' },
    });
    const supabase: MerchantShippingRatesRpcClient = {
      rpc: vi.fn().mockRejectedValue(jwtError),
    };

    // Act
    const request = getMerchantShippingRatesOrThrow(supabase, 'merchant-1');

    // Assert
    await expect(request).rejects.toMatchObject({
      name: 'MerchantShippingRatesLoadError',
      cause: jwtError,
      code: 'UND_ERR_SOCKET',
    });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('does not retry normalized PGRST301 details when the message looks transient', async () => {
    // Arrange — postgrest-js normalizes a fetch rejection into an RPC error
    // with an empty code and includes the upstream auth code in details.
    const normalizedError = {
      code: '',
      details:
        'TypeError: fetch failed\n\nCaused by: Error: JWT decode failed (PGRST301)',
      hint: '',
      message: 'TypeError: fetch failed',
    };
    const supabase = clientWith({ error: normalizedError });

    // Act
    const request = getMerchantShippingRatesOrThrow(supabase, 'merchant-1');

    // Assert
    await expect(request).rejects.toMatchObject({
      name: 'MerchantShippingRatesLoadError',
      cause: normalizedError,
    });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });
});
