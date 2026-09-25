import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { parseJumiaOAuthExchangeRequest } from './parse-jumia-oauth-exchange-request';

describe('parseJumiaOAuthExchangeRequest', () => {
  it('returns validated exchange input', async () => {
    const result = await parseJumiaOAuthExchangeRequest(
      new NextRequest('http://localhost/exchange', {
        method: 'POST',
        body: JSON.stringify({
          code: 'authorization-code',
          ticketId: '00000000-0000-4000-8000-000000000001',
        }),
      })
    );

    expect(result).toMatchObject({ success: true });
  });

  it('returns 400 for invalid JSON', async () => {
    const result = await parseJumiaOAuthExchangeRequest(
      new NextRequest('http://localhost/exchange', {
        method: 'POST',
        body: '{',
      })
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.response.status).toBe(400);
  });
});
