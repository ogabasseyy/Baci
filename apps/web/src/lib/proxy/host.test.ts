import { describe, expect, it } from 'vitest';
import {
  extractLocalhostSubdomain,
  extractSubdomain,
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
});
