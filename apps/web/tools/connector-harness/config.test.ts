import { describe, expect, it } from 'vitest';
import { loadHarnessConfig } from './config';

const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  HARNESS_ENABLED: '1',
  HARNESS_DATABASE_URL:
    'postgres://connector_gateway:secret@127.0.0.1:5432/baci',
  HARNESS_OWNER_SECRET: 'x'.repeat(32),
  HARNESS_TEST_OWNER_USER_ID: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  HARNESS_TEST_MERCHANT_ID: '11111111-1111-4111-8111-111111111111',
};

describe('loadHarnessConfig', () => {
  it('loads a valid test configuration with host/port defaults', () => {
    expect(loadHarnessConfig({ ...BASE_ENV })).toEqual({
      host: '127.0.0.1',
      port: 3101,
      databaseUrl: BASE_ENV.HARNESS_DATABASE_URL,
      ownerSecret: 'x'.repeat(32),
      testOwnerUserId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      testMerchantId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('refuses production and requires the enable flag', () => {
    expect(() =>
      loadHarnessConfig({ ...BASE_ENV, NODE_ENV: 'production' })
    ).toThrow('harness_refused_production');
    expect(() =>
      loadHarnessConfig({ ...BASE_ENV, HARNESS_ENABLED: '0' })
    ).toThrow('harness_not_enabled');
  });

  it('rejects missing secrets, bad ports, and non-uuid identities', () => {
    expect(() =>
      loadHarnessConfig({ ...BASE_ENV, HARNESS_OWNER_SECRET: 'short' })
    ).toThrow('harness_config_invalid:HARNESS_OWNER_SECRET');
    expect(() =>
      loadHarnessConfig({ ...BASE_ENV, HARNESS_PORT: '99999' })
    ).toThrow('harness_config_invalid:HARNESS_PORT');
    expect(loadHarnessConfig({ ...BASE_ENV, HARNESS_PORT: '0' }).port).toBe(0);
    expect(() =>
      loadHarnessConfig({
        ...BASE_ENV,
        HARNESS_TEST_OWNER_USER_ID: 'not-a-uuid',
      })
    ).toThrow('harness_config_invalid:HARNESS_TEST_OWNER_USER_ID');
    const { HARNESS_DATABASE_URL: _dropped, ...rest } = BASE_ENV;
    expect(() => loadHarnessConfig(rest)).toThrow(
      'harness_config_missing:HARNESS_DATABASE_URL'
    );
  });
});
