// @vitest-environment node

import { describe, expect, it } from 'vitest';

describe('GET /auth.md', () => {
  it('serves agent auth guidance with discovery metadata links', async () => {
    const { GET } = await import('./route');
    const response = GET(
      new Request('https://ogabassey.com/auth.md', {
        headers: { host: 'merchant.example.com' },
      })
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=3600, s-maxage=3600'
    );
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noarchive');
    expect(body).toContain('# auth.md');
    expect(body).toContain('https://merchant.example.com/agent-commerce.json');
    expect(body).toContain(
      'https://merchant.example.com/.well-known/oauth-protected-resource'
    );
    expect(body).toContain(
      'https://merchant.example.com/.well-known/oauth-authorization-server'
    );
    expect(body).toContain('## agent_auth');
    expect(body).toContain(
      'register_uri: https://merchant.example.com/.well-known/agent-auth'
    );
    expect(body).toContain(
      'claim_uri: https://merchant.example.com/.well-known/agent-auth/claim'
    );
    expect(body).toContain('credential_types_supported: api_key');
    expect(body).toContain('bearer_hmac');
    expect(body).toContain('Authorization: Bearer <credential>');
    expect(body).toContain('read-only catalog');
    expect(body).toContain('approved\nintegrations after review');
    expect(body).toContain('409 responses as recoverable checkout');
  });
});
