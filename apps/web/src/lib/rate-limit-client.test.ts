import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  getClientIdentifier,
  getTrustedClientIdentifier,
} from './rate-limit-client';

function requestWith(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:3000/api/storefront/cart', {
    headers,
  });
}

describe('getClientIdentifier', () => {
  it('prefers x-real-ip over forwarded entries', () => {
    expect(
      getClientIdentifier(
        requestWith({
          'x-forwarded-for': '203.0.113.1',
          'x-real-ip': '192.0.2.44',
        })
      )
    ).toBe('192.0.2.44');
  });

  it('uses the last valid forwarded entry', () => {
    expect(
      getClientIdentifier(
        requestWith({ 'x-forwarded-for': 'bad, 198.51.100.9' })
      )
    ).toBe('198.51.100.9');
  });

  it('falls back to unknown when no valid address is present', () => {
    expect(getClientIdentifier(requestWith({}))).toBe('unknown');
  });
});

describe('getTrustedClientIdentifier', () => {
  it('never trusts x-forwarded-for', () => {
    expect(
      getTrustedClientIdentifier(
        requestWith({ 'x-forwarded-for': '203.0.113.1' })
      )
    ).toBe('unknown');
  });

  it('uses the platform-set x-real-ip', () => {
    expect(
      getTrustedClientIdentifier(requestWith({ 'x-real-ip': '192.0.2.44' }))
    ).toBe('192.0.2.44');
  });
});
