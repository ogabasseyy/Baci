import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET } from './runtime-impl';

describe('Jumia callback runtime implementation', () => {
  it('rejects a callback when the OAuth state cookie is missing', async () => {
    const response = await GET(
      new NextRequest('https://usebaci.com/api/marketplace/jumia/callback')
    );

    expect(response.headers.get('location')).toContain('error=invalid_state');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('hands a valid mobile callback back through the deep-link redirect', async () => {
    const request = new NextRequest(
      'https://usebaci.com/api/marketplace/jumia/callback?code=mobile-code&state=mobile-state',
      {
        headers: {
          cookie:
            'jumia_oauth_state=mobile-state; jumia_oauth_platform=mobile; jumia_ticket_id=ticket-123',
        },
      }
    );

    const response = await GET(request);

    expect(response.headers.get('location')).toBe(
      'baciadmin://sales-channels?code=mobile-code&ticketId=ticket-123'
    );
  });
});
