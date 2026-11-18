import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { shopperIp } from './shopper-ip';

describe('shopperIp', () => {
  it('returns undefined when no valid address exists', () => {
    expect(
      shopperIp(new NextRequest('https://x.test/api/events'))
    ).toBeUndefined();
  });
  it('returns a valid forwarded address', () => {
    const request = new NextRequest('https://x.test/api/events', {
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(shopperIp(request)).toBe('203.0.113.7');
  });
});
