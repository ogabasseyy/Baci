import { describe, expect, it } from 'vitest';
import { isCloudflareEgressIp } from './cloudflare-egress';

describe('isCloudflareEgressIp', () => {
  it.each([
    // [ip, in 172.64.0.0/13]
    '172.64.0.0',
    '172.64.0.1',
    '172.71.255.255',
    // [ip, in 104.16.0.0/13]
    '104.16.0.0',
    '104.23.255.255',
    // [ip, in 103.21.244.0/22]
    '103.21.244.0',
    '103.21.247.255',
  ])('matches published egress %s', (ip) => {
    expect(isCloudflareEgressIp(ip)).toBe(true);
  });

  it.each([
    '172.63.255.255', // just below 172.64.0.0/13
    '172.72.0.0', // just above 172.64.0.0/13
    '104.15.255.255', // just below 104.16.0.0/13
    '103.21.243.255', // just below 103.21.244.0/22
    '103.21.248.0', // just above 103.21.244.0/22
    '192.0.2.1',
    '8.8.8.8',
  ])('rejects non-egress %s', (ip) => {
    expect(isCloudflareEgressIp(ip)).toBe(false);
  });

  it.each([
    '2606:4700:0000:0000:0000:0000:0000:0001',
    '2606:4700:ffff:ffff:ffff:ffff:ffff:ffff',
    '2a06:98c0:0000:0000:0000:0000:0000:0001', // in /29
    '2a06:98c7:ffff:ffff:ffff:ffff:ffff:ffff', // top of /29 (98c0|7)
  ])('matches published egress %s', (ip) => {
    expect(isCloudflareEgressIp(ip)).toBe(true);
  });

  it.each([
    '2606:4701:0000:0000:0000:0000:0000:0001', // outside /32
    '2a06:98c8:0000:0000:0000:0000:0000:0001', // just above /29
    '2001:0db8:0000:0000:0000:0000:0000:0001',
  ])('rejects non-egress %s', (ip) => {
    expect(isCloudflareEgressIp(ip)).toBe(false);
  });

  it.each([
    '',
    'not-an-ip',
    '1.2.3.4, 5.6.7.8',
    '::ffff:1.2.3.4',
  ])('rejects malformed %s', (ip) => {
    expect(isCloudflareEgressIp(ip)).toBe(false);
  });
});
