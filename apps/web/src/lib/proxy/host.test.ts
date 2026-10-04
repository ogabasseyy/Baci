import { describe, expect, it, vi } from 'vitest';
import {
  extractLocalhostSubdomain,
  extractSubdomain,
  isLocalhost,
  isPlatformHost,
  isValidCustomDomain,
  normalizeHostname,
} from './host';

describe('proxy host helpers', () => {
  it('normalizes ports and accepts only one valid merchant label', () => {
    expect(normalizeHostname('Shop.UseBaci.com:443')).toBe('shop.usebaci.com');
    expect(extractSubdomain('shop.usebaci.com', 'usebaci.com')).toBe('shop');
    expect(extractSubdomain('a.shop.usebaci.com', 'usebaci.com')).toBeNull();
  });

  it('keeps platform and custom-domain classification separate', () => {
    expect(isPlatformHost('www.usebaci.com')).toBe(true);
    expect(isPlatformHost('shop.usebaci.com')).toBe(false);
    expect(isValidCustomDomain('shop.example.com')).toBe(true);
    expect(isValidCustomDomain('127.0.0.1')).toBe(false);
    expect(extractLocalhostSubdomain('shop.localhost')).toBe('shop');
  });

  it.each([
    'localhost',
    '127.0.0.1',
    'shop.localhost',
    '192.168.100.84:3001',
    '10.0.2.15',
    '172.16.5.4',
    '172.31.255.1',
  ])('treats %s as local in development', (host) => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(isLocalhost(host)).toBe(true);
    vi.unstubAllEnvs();
  });

  it.each([
    '172.15.0.1',
    '172.32.0.1',
    '203.0.113.9',
    'shop.usebaci.com',
  ])('rejects %s as non-local', (host) => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(isLocalhost(host)).toBe(false);
    vi.stubEnv('NODE_ENV', 'production');
    expect(isLocalhost(host)).toBe(false);
    vi.unstubAllEnvs();
  });

  it('keeps private ranges gated on development', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(isLocalhost('192.168.100.84')).toBe(false);
    expect(isLocalhost('10.0.2.15')).toBe(false);
    expect(isLocalhost('172.20.1.1')).toBe(false);
    expect(isLocalhost('localhost')).toBe(true);
    vi.unstubAllEnvs();
  });
});
