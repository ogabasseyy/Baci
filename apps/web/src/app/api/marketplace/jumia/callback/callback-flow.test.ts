import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET } from './callback-flow';

describe('Jumia callback flow', () => {
  it('returns an invalid-state redirect for a missing state cookie', async () => {
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/marketplace/jumia/callback?state=x'
      )
    );
    expect(response.headers.get('location')).toContain('error=invalid_state');
  });
});
