import { describe, expect, it, vi } from 'vitest';
import { requestPiggyvestStagingJson } from './staging-json-request';
import { PiggyvestStagingJsonRequestError } from './staging-json-request.errors';

describe('staging request error redaction', () => {
  it('replaces provider errors with a typed error without retaining private cause data', async () => {
    const providerError = new Error('synthetic-private-provider-detail', {
      cause: { authorization: 'synthetic-private-credential' },
    });
    const result = await requestPiggyvestStagingJson({
      configuration: {
        apiSecret: 'synthetic-private-credential',
        expectedBusinessId: 'synthetic-business',
      },
      path: '/api/v1/customers',
      method: 'POST',
      body: '{"email":"synthetic-private@example.test"}',
      fetchImplementation: vi.fn().mockRejectedValue(providerError),
    }).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(PiggyvestStagingJsonRequestError);
    expect(result).toMatchObject({ code: 'NETWORK_ERROR' });
    expect(result).not.toHaveProperty('cause');
    expect(String(result)).not.toContain('synthetic-private');
    expect(JSON.stringify(result)).not.toContain('synthetic-private');
  });
});
