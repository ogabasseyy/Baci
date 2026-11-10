import { X509Certificate } from 'node:crypto';
import { expect, it } from 'vitest';
import { createPerformanceTls } from './performance-tls';

it('creates an ephemeral leaf for exactly the two synthetic harness hosts', () => {
  const tls = createPerformanceTls([
    'https://host.synthetic.test',
    'https://frame.synthetic.test',
  ]);
  try {
    const cert = new X509Certificate(tls.options.cert as Buffer);
    expect(cert.checkHost('host.synthetic.test')).toBeTruthy();
    expect(cert.checkHost('frame.synthetic.test')).toBeTruthy();
    expect(cert.checkHost('other.synthetic.test')).toBeUndefined();
    expect(tls.spki).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  } finally {
    tls.close();
  }
  expect(() =>
    createPerformanceTls([
      'https://host.synthetic.test',
      'https://host.synthetic.test',
    ])
  ).toThrow();
});
