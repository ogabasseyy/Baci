import { hasPrivateHost } from './has-private-host';

describe('private host detection', () => {
  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '100.64.0.1',
    '100.127.255.255',
  ])('rejects a non-public host %s', (host) =>
    expect(hasPrivateHost(`http://${host}/`)).toBe(true));
  it.each(['100.63.255.255', '100.128.0.0'])('accepts %s', (host) =>
    expect(hasPrivateHost(`http://${host}/`)).toBe(false));
  it.each([
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.0',
    '172.31.255.255',
    '192.168.0.1',
    'localhost',
    'api.localhost',
    'printer.local',
    '[::1]',
    '[fd00::1]',
    '[fe80::1]',
  ])('rejects private host %s', (host) =>
    expect(hasPrivateHost(`http://${host}/`)).toBe(true));
  it.each([
    '172.15.255.255',
    '172.32.0.0',
    '8.8.8.8',
    'chowdeck-api.readme.io',
  ])('accepts public host %s', (host) =>
    expect(hasPrivateHost(`http://${host}/`)).toBe(false));
  it('rejects an unparsable URL candidate', () => {
    expect(hasPrivateHost('http://[::1')).toBe(true);
  });
});
