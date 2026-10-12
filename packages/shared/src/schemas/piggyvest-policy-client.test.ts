import { describe, expect, it } from 'vitest';
import { piggyvestPolicyClientSchemas as schemas } from './piggyvest-policy-client';

const configuration = {
  mode: 'local_test',
  baseUrl: 'http://127.0.0.1:3000',
  endpointPath: '/local/policy',
};
describe('local policy transport configuration', () => {
  it('defaults to no cookies and accepts literal IPv6 loopback', () => {
    expect(schemas.configuration.parse(configuration).credentials).toBe('omit');
    expect(
      schemas.configuration.safeParse({
        ...configuration,
        baseUrl: 'http://[::1]:3000/',
      }).success
    ).toBe(true);
  });
  it.each([
    { mode: 'production' },
    { baseUrl: 'http://127.0.0.1:65536' },
    { baseUrl: 'http://127.0.0.1:0' },
    { endpointPath: '//other.test' },
    { endpointPath: '/local/../policy' },
    { endpointPath: '/local?token=x' },
    { headers: {} },
    { credentials: 'bearer' },
  ])('rejects unsafe configuration %j', (change) => {
    expect(
      schemas.configuration.safeParse({ ...configuration, ...change }).success
    ).toBe(false);
  });
  it.each([
    '',
    'a'.repeat(513),
    'bad token',
    'bad\nheader',
  ])('rejects invalid CSRF tokens', (token) => {
    expect(schemas.csrf.safeParse(token).success).toBe(false);
  });
});
