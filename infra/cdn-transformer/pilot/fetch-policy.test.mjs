import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPublicFetchUrl } from './fetch-policy.mjs';

test('denies loopback, private, and link-local fetch destinations', () => {
  for (const host of [
    'localhost',
    'LOCALHOST',
    'localhost.',
    'app.localhost',
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '224.0.0.1',
    '100.64.0.1',
    '100.127.255.255',
    '192.0.0.1',
    '192.0.2.10',
    '192.88.99.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.3',
    '203.0.113.7',
    '[::1]',
    '[::]',
    '[0:0:0:0:0:0:0:1]',
    '[fe80::1]',
    '[fec0::1]',
    '[feff::1]',
    '[fc00::1]',
    '[fd12:3456::1]',
    '[ff02::1]',
    '[2001:db8::1]',
    '[2001::1]',
    '[2001:2::1]',
    '[64:ff9b::808:808]',
    '[64:ff9b:1::1]',
    '[100::1]',
    '[::ffff:127.0.0.1]',
    '[::ffff:10.1.2.3]',
    '2130706433',
    '3232235521',
    '127.1',
    '10.0.1',
    '0177.0.0.1',
    '0x7f.0.0.1',
    '0x7f000001',
    '[::ffff:7f00:1]',
  ]) {
    assert.throws(
      () => assertPublicFetchUrl(`http://user@${host}:8080/a.png?x=1`),
      /refusing (loopback|non-public) fetch destination/,
      host
    );
  }
});

test('allows public literals and operator-trusted hostnames', () => {
  for (const host of [
    'cdn.example.com',
    '8.8.8.8',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.9.9',
    '172.32.0.1',
    '192.0.3.1',
    '198.20.0.1',
    '[2001:4860:4860::8888]',
    '[::ffff:8.8.8.8]',
    '[0:0:0:0:0:ffff:808:808]',
    '134744072',
    '0xpress.example',
  ]) {
    assert.doesNotThrow(
      () => assertPublicFetchUrl(`https://${host}/a.png`),
      host
    );
  }
});

test('rejects malformed URLs', () => {
  assert.throws(() => assertPublicFetchUrl('not a url'), /invalid URL/);
  // Over-wide "octets" fail closed at URL parse, before the guard.
  assert.throws(
    () => assertPublicFetchUrl('http://999.1.1.1/a.png'),
    /invalid URL/
  );
});
