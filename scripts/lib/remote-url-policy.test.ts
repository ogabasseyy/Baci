import { describe, expect, it } from 'vitest';
import { isBlockedRemoteHost, validateRemoteUrl } from './remote-url-policy';

describe('isBlockedRemoteHost', () => {
  it('allows ordinary public hostnames', () => {
    expect(isBlockedRemoteHost('cdn.example.com')).toBe(false);
    expect(isBlockedRemoteHost('images.merchant.com')).toBe(false);
  });

  it('does not mistake hostnames starting with fc or fd for IPv6 literals', () => {
    expect(isBlockedRemoteHost('fcdn.example.com')).toBe(false);
    expect(isBlockedRemoteHost('fdimages.example.com')).toBe(false);
  });

  it('blocks loopback and local names', () => {
    expect(isBlockedRemoteHost('localhost')).toBe(true);
    expect(isBlockedRemoteHost('app.localhost')).toBe(true);
    expect(isBlockedRemoteHost('printer.local')).toBe(true);
  });

  it('blocks cloud metadata endpoints', () => {
    expect(isBlockedRemoteHost('metadata.google.internal')).toBe(true);
    expect(isBlockedRemoteHost('metadata')).toBe(true);
  });

  it('blocks IPv4 private, loopback, and link-local ranges', () => {
    expect(isBlockedRemoteHost('10.1.2.3')).toBe(true);
    expect(isBlockedRemoteHost('127.0.0.1')).toBe(true);
    expect(isBlockedRemoteHost('169.254.169.254')).toBe(true);
    expect(isBlockedRemoteHost('172.16.0.1')).toBe(true);
    expect(isBlockedRemoteHost('172.31.255.255')).toBe(true);
    expect(isBlockedRemoteHost('192.168.1.1')).toBe(true);
    expect(isBlockedRemoteHost('0.0.0.0')).toBe(true);
    expect(isBlockedRemoteHost('8.8.8.8')).toBe(false);
  });

  it('blocks IPv6 loopback, link-local, and unique-local literals', () => {
    expect(isBlockedRemoteHost('::1')).toBe(true);
    expect(isBlockedRemoteHost('fe80::1')).toBe(true);
    expect(isBlockedRemoteHost('fc00::1')).toBe(true);
    expect(isBlockedRemoteHost('fd00::1')).toBe(true);
    expect(isBlockedRemoteHost('2001:db8::1')).toBe(false);
  });

  it('blocks IPv4-mapped IPv6 destinations by their embedded address', () => {
    expect(isBlockedRemoteHost('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedRemoteHost('::ffff:7f00:1')).toBe(true);
    expect(isBlockedRemoteHost('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedRemoteHost('::ffff:8.8.8.8')).toBe(false);
    expect(validateRemoteUrl('http://[::ffff:127.0.0.1]/image')).toBeNull();
  });

  it('blocks the full link-local range and the unspecified address', () => {
    expect(isBlockedRemoteHost('::')).toBe(true);
    expect(isBlockedRemoteHost('fe90::1')).toBe(true);
    expect(isBlockedRemoteHost('febf:ffff::1')).toBe(true);
    expect(isBlockedRemoteHost('fec0::1')).toBe(false);
  });

  it('fails closed on malformed colon-bearing hostnames', () => {
    expect(isBlockedRemoteHost('foo:bar')).toBe(true);
    expect(isBlockedRemoteHost('12345::67890')).toBe(true);
  });

  it('strips URL brackets before classifying IPv6 literals', () => {
    expect(isBlockedRemoteHost('[::1]')).toBe(true);
    expect(isBlockedRemoteHost('[fe80::1]')).toBe(true);
    expect(isBlockedRemoteHost('[fc00::1]')).toBe(true);
    expect(isBlockedRemoteHost('[2001:db8::1]')).toBe(false);
    expect(validateRemoteUrl('http://[::1]/image')).toBeNull();
    expect(validateRemoteUrl('http://[fc00::1]/image')).toBeNull();
    expect(
      validateRemoteUrl('http://[2001:db8::1]/image')?.toString()
    ).toBe('http://[2001:db8::1]/image');
  });
});

describe('validateRemoteUrl', () => {
  it('accepts public http and https image URLs', () => {
    expect(
      validateRemoteUrl('https://cdn.example.com/p.jpg')?.toString()
    ).toBe('https://cdn.example.com/p.jpg');
    expect(
      validateRemoteUrl('http://fcdn.example.com/p.jpg')?.toString()
    ).toBe('http://fcdn.example.com/p.jpg');
  });

  it('rejects blocked hosts, mismatched protocols, and malformed URLs', () => {
    expect(validateRemoteUrl('https://169.254.169.254/')).toBeNull();
    expect(validateRemoteUrl('ftp://cdn.example.com/p.jpg')).toBeNull();
    expect(validateRemoteUrl('not a url')).toBeNull();
    expect(validateRemoteUrl('')).toBeNull();
  });
});
