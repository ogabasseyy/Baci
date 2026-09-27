import { describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({
  env: { JUMIA_ENVIRONMENT: 'production' },
  getJumiaEnvironment: () => 'production' as const,
}));

import {
  getJumiaAuthUrl,
  isJumiaAuthUrlVariant,
  sanitizeJumiaErrorDetails,
} from '@/lib/jumia/helpers';

describe('Jumia OAuth documented-baseline diagnostic variant', () => {
  it('uses exactly the authorization parameters documented by Jumia', () => {
    const url = new URL(
      getJumiaAuthUrl({
        clientId: 'client-id',
        redirectUri: 'https://usebaci.com/api/marketplace/jumia/callback',
        state: 'state',
        variant: 'F',
      })
    );

    expect(url.searchParams.get('scope')).toBe('openid');
    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.has('max_age')).toBe(false);
    expect([...url.searchParams.keys()].sort()).toEqual(
      [
        'client_id',
        'prompt',
        'redirect_uri',
        'response_type',
        'scope',
        'state',
      ].sort()
    );
    expect(isJumiaAuthUrlVariant('F')).toBe(true);
    expect(isJumiaAuthUrlVariant('f')).toBe(false);
    expect(isJumiaAuthUrlVariant('unknown')).toBe(false);
  });

  it('redacts form-encoded token fields', () => {
    expect(
      sanitizeJumiaErrorDetails(
        'error=invalid_grant&refresh_token=secret-refresh&access_token=secret-access'
      )
    ).toBe(
      'error=invalid_grant&refresh_token=[REDACTED]&access_token=[REDACTED]'
    );
  });
});
