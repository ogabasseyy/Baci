import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET } from './runtime';

describe('Jumia callback runtime', () => {
  it('returns an invalid-state response when state is missing', async () => {
    const response = await GET(
      new NextRequest('https://usebaci.com/api/marketplace/jumia/callback')
    );
    expect(response.headers.get('location')).toContain('error=invalid_state');
  });
});
