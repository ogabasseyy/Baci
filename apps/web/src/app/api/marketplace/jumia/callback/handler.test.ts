import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET } from './handler';

describe('Jumia callback handler', () => {
  it('returns invalid_state when the OAuth state cookie does not match', async () => {
    const request = new NextRequest(
      'https://usebaci.com/api/marketplace/jumia/callback?state=request-state',
      { headers: { cookie: 'jumia_oauth_state=stored-state' } }
    );

    const response = await GET(request);

    expect(response.headers.get('location')).toContain('error=invalid_state');
  });

  it('returns invalid_state when the OAuth state cookie is absent', async () => {
    const request = new NextRequest(
      'https://usebaci.com/api/marketplace/jumia/callback?state=request-state'
    );

    const response = await GET(request);

    expect(response.headers.get('location')).toContain('error=invalid_state');
  });
});
