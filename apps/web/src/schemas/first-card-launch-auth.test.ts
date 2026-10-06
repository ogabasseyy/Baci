import { describe, expect, it } from 'vitest';
import { firstCardLaunchAuthSchema } from './first-card-launch-auth';

const anonKey = [
  Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url'),
  'signature',
].join('.');
const serviceKey = [
  Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url'),
  'signature',
].join('.');

describe('firstCardLaunchAuthSchema', () => {
  it('accepts the staging origin with a public anon JWT', () => {
    expect(
      firstCardLaunchAuthSchema.safeParse({
        url: 'https://staging-auth.ogabassey.com',
        key: anonKey,
      }).success
    ).toBe(true);
  });

  it('refuses privileged roles', () => {
    expect(
      firstCardLaunchAuthSchema.safeParse({
        url: 'https://staging-auth.ogabassey.com',
        key: serviceKey,
      }).success
    ).toBe(false);
  });

  it('refuses non-staging origins and malformed keys', () => {
    expect(
      firstCardLaunchAuthSchema.safeParse({
        url: 'https://auth.ogabassey.com',
        key: anonKey,
      }).success
    ).toBe(false);
    expect(
      firstCardLaunchAuthSchema.safeParse({
        url: 'https://staging-auth.ogabassey.com',
        key: 'not-a-jwt',
      }).success
    ).toBe(false);
  });
});
