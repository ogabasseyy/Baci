import { describe, expect, it } from 'vitest';
import { POST } from './route';

const headers = {
  cookie: 'csrf-token=fixture-csrf-token',
  'x-csrf-token': 'fixture-csrf-token',
};

function post(
  endpoint: string,
  body: unknown,
  requestHeaders: Record<string, string> = headers
) {
  return POST(
    new Request(
      `http://localhost/api/storefront/chatwoot/context/${endpoint}?merchantSlug=ogabassey`,
      {
        method: 'POST',
        headers: requestHeaders,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }
    ),
    { params: Promise.resolve({ endpoint }) }
  );
}

describe('fixture Chatwoot context route', () => {
  it('rejects missing CSRF cookies and malformed JSON', async () => {
    const missingCookie = await post(
      'challenge',
      {},
      {
        'x-csrf-token': 'fixture-csrf-token',
      }
    );
    const malformedJson = await post('challenge', '{', headers);

    expect(missingCookie.status).toBe(403);
    expect(malformedJson.status).toBe(400);
  });

  it('returns a challenge only for the exact fixture merchant query', async () => {
    const challenge = await post('challenge', {
      requestId: 'fixture_context_123456',
    });
    const response = await challenge.json();

    expect(challenge.status).toBe(200);
    expect(challenge.headers.get('x-fixture-csrf-cookie-validated')).toBe(
      'true'
    );
    expect(response).toMatchObject({
      requestId: 'fixture_context_123456',
      challengeToken: 'synthetic-challenge-token',
    });
  });

  it('rejects verify and authorize requests with mismatched tokens', async () => {
    const verify = await post('verify', {
      challengeToken: 'wrong',
      contextToken: 'synthetic-context-token',
    });
    const authorize = await post('authorize', {
      sessionToken: 'wrong',
      includeCartSnapshot: true,
    });

    expect(verify.status).toBe(403);
    expect(authorize.status).toBe(403);
  });

  it('returns synthetic session and cart data for the bound tokens', async () => {
    const verified = await post('verify', {
      challengeToken: 'synthetic-challenge-token',
      contextToken: 'synthetic-context-token',
    });
    const authorized = await post('authorize', {
      sessionToken: 'synthetic-session-capability',
      includeCartSnapshot: true,
    });

    expect(verified.status).toBe(200);
    expect(authorized.status).toBe(200);
    expect((await authorized.json()).cartSnapshot.items[0]).toMatchObject({
      name: 'Canonical server phone',
      lineId: 'server-line-1',
    });
  });
});
