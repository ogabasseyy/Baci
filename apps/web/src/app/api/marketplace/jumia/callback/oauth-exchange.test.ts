import { describe, expect, it, vi } from 'vitest';

const { exchange, error } = vi.hoisted(() => ({
  exchange: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/jumia/helpers', () => ({
  exchangeJumiaCode: (...args: unknown[]) => exchange(...args),
  sanitizeJumiaErrorDetails: (details: unknown) => details,
}));
vi.mock('@/lib/logger', () => ({ logger: { error, info: vi.fn() } }));

import { exchangeJumiaOAuthTokens } from './oauth-exchange';

describe('exchangeJumiaOAuthTokens', () => {
  it('forwards exchange inputs and returns provider tokens', async () => {
    const tokens = {
      access_token: 'access',
      expires_in: 3600,
      token_type: 'bearer',
    };
    exchange.mockResolvedValueOnce(tokens);

    await expect(
      exchangeJumiaOAuthTokens({
        clientId: 'client',
        clientSecret: 'secret',
        code: 'code',
        merchantId: 'merchant',
        redirectUri: 'https://example.com/callback',
        variant: 'A',
      })
    ).resolves.toEqual(tokens);
    expect(exchange).toHaveBeenCalledWith({
      clientId: 'client',
      clientSecret: 'secret',
      code: 'code',
      redirectUri: 'https://example.com/callback',
    });
  });

  it('sanitizes and rethrows provider failures', async () => {
    exchange.mockRejectedValueOnce(
      Object.assign(new Error('failed'), { details: 'refresh_token=secret' })
    );

    await expect(
      exchangeJumiaOAuthTokens({
        clientId: 'client',
        clientSecret: 'secret',
        code: 'code',
        merchantId: 'merchant',
        redirectUri: 'https://example.com/callback',
      })
    ).rejects.toThrow('JUMIA_TOKEN_EXCHANGE_FAILED');
    expect(error).toHaveBeenCalled();
  });
});
