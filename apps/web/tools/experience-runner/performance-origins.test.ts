import { expect, it } from 'vitest';
import { performanceCss, performanceOrigins } from './performance-origins';

it('keeps production HTTPS origins exact and execution on a separate cookie site', () => {
  expect(performanceOrigins('https://shop.synthetic.test:8443')).toMatchObject({
    origin: 'https://shop.synthetic.test:8443',
    frameOrigin: 'https://artifacts.baci-cwv.invalid',
    transport: 'https-loopback-tls',
  });
  expect(() => performanceOrigins('https://shop.baci-cwv.invalid')).toThrow();
  expect(() => performanceOrigins('http://example.com:4100')).toThrow();
});
it('rewrites complete known CSS asset references without corrupting prefix IDs', () => {
  expect(
    performanceCss(
      'url("/assets/a-long") url(/assets/a) url(/assets/unknown)',
      'https://artifacts.baci-cwv.invalid/resource/digest',
      ['a', 'a-long']
    )
  ).toBe(
    'url("https://artifacts.baci-cwv.invalid/resource/digest/assets/a-long") url(https://artifacts.baci-cwv.invalid/resource/digest/assets/a) url(/assets/unknown)'
  );
});
