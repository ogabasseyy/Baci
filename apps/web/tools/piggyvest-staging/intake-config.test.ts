import { describe, expect, it } from 'vitest';
import { parseIntakeConfig } from './intake-config';

const now = 1700000000000;
const token = (role: string, exp = now / 1000 + 3600) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role, exp })).toString('base64url')}.c3ludGhldGlj`;
const config = {
  environment: 'staging',
  integrationToken: 'a'.repeat(64),
  providerSecret: 'test_key_synthetic',
  encryptionKey: Buffer.alloc(32, 1).toString('base64'),
  restToken: token('pvb_staging_ingest'),
};

describe('isolated intake configuration', () => {
  it('accepts staging credentials with the restricted role', () => {
    expect(parseIntakeConfig(config, now).encryptionKey.length).toBe(32);
  });
  it.each([
    'production',
    'preview',
  ])('refuses the %s environment', (environment) => {
    expect(() => parseIntakeConfig({ ...config, environment }, now)).toThrow();
  });
  it('refuses an elevated database token', () => {
    expect(() =>
      parseIntakeConfig({ ...config, restToken: token('service_role') }, now)
    ).toThrow();
  });
  it('refuses expired database credentials', () => {
    expect(() =>
      parseIntakeConfig(
        { ...config, restToken: token('pvb_staging_ingest', now / 1000) },
        now
      )
    ).toThrow();
  });
  it('refuses production provider credentials and weak encryption keys', () => {
    expect(() =>
      parseIntakeConfig({ ...config, providerSecret: 'live_synthetic' }, now)
    ).toThrow();
    expect(() =>
      parseIntakeConfig({ ...config, encryptionKey: 'AA==' }, now)
    ).toThrow();
  });
});
