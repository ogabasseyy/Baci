import { describe, expect, it, vi } from 'vitest';
import { GiglApiClient } from './gigl.auth';

describe('seeded tracking authentication', () => {
  it('reuses an unexpired restored token without logging in', async () => {
    const safeFetch = vi.fn();
    const token = {
      token: 'synthetic-token',
      userChannelCode: 'channel',
      customerType: 1,
      expiresAt: Date.now() + 60_000,
    };
    const client = new GiglApiClient({ safeFetch, log: vi.fn() }, token);
    await expect(client.getApiToken()).resolves.toEqual(token);
    expect(safeFetch).not.toHaveBeenCalled();
  });
});
