import { describe, expect, it } from 'vitest';
import { validateRemoteUrl } from './remote-url-policy';

const url = (host: string) => `http://${
  host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}/p.jpg`;

describe('validateRemoteUrl host classification', () => {
  it('allows ordinary public hostnames', () => {
    expect(validateRemoteUrl(url('cdn.example.com'))?.toString()).toBe(
      url('cdn.example.com'),
    );
    expect(validateRemoteUrl(url('images.merchant.com'))?.toString()).toBe(
      url('images.merchant.com'),
    );
  });

  it('does not mistake hostnames starting with fc or fd for IPv6 literals', () => {
    expect(validateRemoteUrl(url('fcdn.example.com'))?.toString()).toBe(
      url('fcdn.example.com'),
    );
    expect(validateRemoteUrl(url('fdimages.example.com'))?.toString()).toBe(
      url('fdimages.example.com'),
    );
  });

  it('blocks loopback and local names', () => {
    expect(validateRemoteUrl(url('localhost'))).toBeNull();
    expect(validateRemoteUrl(url('app.localhost'))).toBeNull();
    expect(validateRemoteUrl(url('printer.local'))).toBeNull();
  });

  it('blocks cloud metadata endpoints', () => {
    expect(validateRemoteUrl(url('metadata.google.internal'))).toBeNull();
    expect(validateRemoteUrl(url('metadata'))).toBeNull();
  });

  it('blocks IPv4 private, loopback, and link-local ranges', () => {
    for (const host of [
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '0.0.0.0',
    ]) {
      expect(validateRemoteUrl(url(host))).toBeNull();
    }
    expect(validateRemoteUrl(url('8.8.8.8'))?.toString()).toBe(url('8.8.8.8'));
  });

  it('blocks shared-address CGNAT space including provider metadata endpoints', () => {
    for (const host of ['100.64.0.1', '100.100.100.200', '100.127.255.255']) {
      expect(validateRemoteUrl(url(host))).toBeNull();
    }
    expect(validateRemoteUrl(url('100.63.255.255'))?.toString()).toBe(
      url('100.63.255.255'),
    );
    expect(validateRemoteUrl(url('100.128.0.1'))?.toString()).toBe(
      url('100.128.0.1'),
    );
  });

  it('blocks documentation TEST-NET destinations', () => {
    for (const host of [
      '192.0.2.1',
      '192.0.2.255',
      '198.51.100.23',
      '203.0.113.7',
    ]) {
      expect(validateRemoteUrl(url(host))).toBeNull();
    }
    // Adjacent space outside the documentation ranges stays reachable.
    for (const host of ['192.0.3.1', '198.51.101.1', '203.0.114.1']) {
      expect(validateRemoteUrl(url(host))?.toString()).toBe(url(host));
    }
  });

  it('blocks multicast and reserved IPv4 destinations', () => {
    for (const host of ['224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255']) {
      expect(validateRemoteUrl(url(host))).toBeNull();
    }
    // The highest globally routable space stays reachable.
    expect(validateRemoteUrl(url('223.255.255.1'))?.toString()).toBe(
      url('223.255.255.1'),
    );
  });

  it('blocks benchmark-network destinations', () => {
    for (const host of ['198.18.0.1', '198.19.255.255']) {
      expect(validateRemoteUrl(url(host))).toBeNull();
    }
    expect(validateRemoteUrl(url('198.17.255.255'))?.toString()).toBe(
      url('198.17.255.255'),
    );
    expect(validateRemoteUrl(url('198.20.0.1'))?.toString()).toBe(
      url('198.20.0.1'),
    );
  });

  it('blocks IPv6 loopback, link-local, and unique-local literals', () => {
    for (const host of ['::1', 'fe80::1', 'fc00::1', 'fd00::1']) {
      expect(validateRemoteUrl(url(host))).toBeNull();
    }
  });

  it('blocks documentation-only and translation IPv6 destinations', () => {
    for (const host of [
      '2001:db8::1',
      '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff',
      '64:ff9b::808:808',
    ]) {
      expect(validateRemoteUrl(url(host))).toBeNull();
    }
    // Adjacent globally routable space stays reachable.
    expect(validateRemoteUrl(url('2606:4700:4700::1111'))?.toString()).toBe(
      url('2606:4700:4700::1111'),
    );
  });
  it('blocks IPv4-mapped IPv6 destinations by their embedded address', () => {
    for (const host of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1']) {
      expect(validateRemoteUrl(url(host))).toBeNull();
    }
    // Node normalizes the dotted quad to hex; the public address stays allowed.
    expect(validateRemoteUrl(url('::ffff:8.8.8.8'))?.toString()).toBe(
      'http://[::ffff:808:808]/p.jpg',
    );
  });

  it('blocks the full link-local range and the unspecified address', () => {
    for (const host of ['::', 'fe90::1', 'febf:ffff::1']) {
      expect(validateRemoteUrl(url(host))).toBeNull();
    }
  });

  it('blocks deprecated site-local destinations', () => {
    for (const host of ['fec0::1', 'feff::1']) {
      expect(validateRemoteUrl(url(host))).toBeNull();
    }
  });

  it('blocks the IPv6 benchmarking prefix', () => {
    for (const host of ['2001:2::1', '2001:2:ffff:ffff:ffff:ffff:ffff:ffff']) {
      expect(validateRemoteUrl(url(host))).toBeNull();
    }
    // Adjacent prefixes outside 2001:2::/48 stay reachable.
    expect(validateRemoteUrl(url('2001:3::1'))?.toString()).toBe(
      url('2001:3::1'),
    );
  });

  it('rejects malformed bracketed literals during URL parsing', () => {
    expect(validateRemoteUrl('http://[foo:bar]/p.jpg')).toBeNull();
    expect(validateRemoteUrl('http://[12345::67890]/p.jpg')).toBeNull();
  });
});

describe('validateRemoteUrl', () => {
  it('accepts public http and https image URLs', () => {
    expect(
      validateRemoteUrl('https://cdn.example.com/p.jpg')?.toString(),
    ).toBe('https://cdn.example.com/p.jpg');
    expect(
      validateRemoteUrl('http://fcdn.example.com/p.jpg')?.toString(),
    ).toBe('http://fcdn.example.com/p.jpg');
  });

  it('rejects blocked hosts, mismatched protocols, and malformed URLs', () => {
    expect(validateRemoteUrl('https://169.254.169.254/')).toBeNull();
    expect(validateRemoteUrl('ftp://cdn.example.com/p.jpg')).toBeNull();
    expect(validateRemoteUrl('not a url')).toBeNull();
    expect(validateRemoteUrl('')).toBeNull();
  });
});
