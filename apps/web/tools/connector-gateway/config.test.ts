import { describe, expect, it } from 'vitest';
import { loadGatewayConfig } from './config';

const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  CONNECTOR_GATEWAY_ENABLED: '1',
  CONNECTOR_GATEWAY_DATABASE_URL:
    'postgres://connector_gateway:secret@127.0.0.1:5432/baci',
  CONNECTOR_GATEWAY_OWNER_SECRET: 'x'.repeat(32),
  CONNECTOR_GATEWAY_OWNER_USER_ID: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  CONNECTOR_GATEWAY_MERCHANT_ID: '11111111-1111-4111-8111-111111111111',
  CONNECTOR_GATEWAY_PUBLIC_BASE_URL: 'https://connector.staging.example.com',
};

describe('loadGatewayConfig', () => {
  it('loads a valid staging configuration with defaults', () => {
    expect(loadGatewayConfig({ ...BASE_ENV })).toEqual({
      host: '127.0.0.1',
      port: 3201,
      databaseUrl: BASE_ENV.CONNECTOR_GATEWAY_DATABASE_URL,
      localGrantManagement: {
        ownerSecret: 'x'.repeat(32),
        ownerUserId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        merchantId: '11111111-1111-4111-8111-111111111111',
      },
      publicBaseUrl: 'https://connector.staging.example.com',
      rateLimitPerKey: 120,
      rateLimitPerIp: 600,
      rateLimitWindowMs: 60_000,
      trustedProxies: ['127.0.0.1', '::1'],
    });
  });

  it('parses the trusted proxy list strictly', () => {
    expect(
      loadGatewayConfig({
        ...BASE_ENV,
        CONNECTOR_GATEWAY_TRUSTED_PROXIES: '10.0.0.1, 10.0.0.2,10.0.0.1',
      }).trustedProxies
    ).toEqual(['10.0.0.1', '10.0.0.2']);
    for (const bad of ['not-an-ip', '10.0.0.1, nope', ',,,']) {
      expect(() =>
        loadGatewayConfig({
          ...BASE_ENV,
          CONNECTOR_GATEWAY_TRUSTED_PROXIES: bad,
        })
      ).toThrow('gateway_config_invalid:CONNECTOR_GATEWAY_TRUSTED_PROXIES');
    }
  });

  it('requires the enable flag and gates production', () => {
    expect(() =>
      loadGatewayConfig({ ...BASE_ENV, CONNECTOR_GATEWAY_ENABLED: '0' })
    ).toThrow('gateway_not_enabled');
    expect(() =>
      loadGatewayConfig({ ...BASE_ENV, NODE_ENV: 'production' })
    ).toThrow('gateway_production_not_approved');
    const {
      CONNECTOR_GATEWAY_OWNER_SECRET: _ownerSecret,
      CONNECTOR_GATEWAY_OWNER_USER_ID: _ownerUserId,
      CONNECTOR_GATEWAY_MERCHANT_ID: _merchantId,
      ...withoutLocalGrantManagement
    } = BASE_ENV;
    expect(
      loadGatewayConfig({
        ...withoutLocalGrantManagement,
        NODE_ENV: 'production',
        CONNECTOR_GATEWAY_PRODUCTION_APPROVED: '1',
      })
    ).toMatchObject({
      port: 3201,
      localGrantManagement: null,
    });
    expect(() =>
      loadGatewayConfig({
        ...BASE_ENV,
        NODE_ENV: 'production',
        CONNECTOR_GATEWAY_PRODUCTION_APPROVED: '1',
      })
    ).toThrow('gateway_local_grant_management_forbidden_in_production');
  });

  it('requires a stable https base address', () => {
    expect(
      loadGatewayConfig({
        ...BASE_ENV,
        CONNECTOR_GATEWAY_PUBLIC_BASE_URL:
          'https://connector.staging.example.com/v0/',
      }).publicBaseUrl
    ).toBe('https://connector.staging.example.com/v0');
    for (const bad of [
      'http://connector.staging.example.com',
      'ftp://connector.staging.example.com',
      'https://user:pass@connector.staging.example.com',
      'https://connector.staging.example.com?token=value',
      'not-a-url',
    ]) {
      expect(() =>
        loadGatewayConfig({
          ...BASE_ENV,
          CONNECTOR_GATEWAY_PUBLIC_BASE_URL: bad,
        })
      ).toThrow('gateway_config_invalid:CONNECTOR_GATEWAY_PUBLIC_BASE_URL');
    }
    // Loopback http stays available for local validation only.
    expect(
      loadGatewayConfig({
        ...BASE_ENV,
        CONNECTOR_GATEWAY_PUBLIC_BASE_URL: 'http://127.0.0.1:3201/',
      }).publicBaseUrl
    ).toBe('http://127.0.0.1:3201');
    const { CONNECTOR_GATEWAY_PUBLIC_BASE_URL: _dropped, ...rest } = BASE_ENV;
    expect(() => loadGatewayConfig(rest)).toThrow(
      'gateway_config_missing:CONNECTOR_GATEWAY_PUBLIC_BASE_URL'
    );
  });

  it('rejects missing secrets, bad ports, and invalid rate knobs', () => {
    expect(() =>
      loadGatewayConfig({
        ...BASE_ENV,
        CONNECTOR_GATEWAY_OWNER_SECRET: 'short',
      })
    ).toThrow('gateway_config_invalid:CONNECTOR_GATEWAY_OWNER_SECRET');
    expect(() =>
      loadGatewayConfig({ ...BASE_ENV, CONNECTOR_GATEWAY_PORT: '99999' })
    ).toThrow('gateway_config_invalid:CONNECTOR_GATEWAY_PORT');
    expect(
      loadGatewayConfig({ ...BASE_ENV, CONNECTOR_GATEWAY_PORT: '0' }).port
    ).toBe(0);
    expect(() =>
      loadGatewayConfig({
        ...BASE_ENV,
        CONNECTOR_GATEWAY_OWNER_USER_ID: 'not-a-uuid',
      })
    ).toThrow('gateway_config_invalid:CONNECTOR_GATEWAY_OWNER_USER_ID');
    expect(() =>
      loadGatewayConfig({ ...BASE_ENV, CONNECTOR_GATEWAY_RATE_PER_KEY: '0' })
    ).toThrow('gateway_config_invalid:CONNECTOR_GATEWAY_RATE_PER_KEY');
    expect(() =>
      loadGatewayConfig({
        ...BASE_ENV,
        CONNECTOR_GATEWAY_RATE_WINDOW_MS: '500',
      })
    ).toThrow('gateway_config_invalid:CONNECTOR_GATEWAY_RATE_WINDOW_MS');
    expect(
      loadGatewayConfig({
        ...BASE_ENV,
        CONNECTOR_GATEWAY_RATE_PER_KEY: '10',
        CONNECTOR_GATEWAY_RATE_PER_IP: '50',
        CONNECTOR_GATEWAY_RATE_WINDOW_MS: '5000',
      })
    ).toMatchObject({
      rateLimitPerKey: 10,
      rateLimitPerIp: 50,
      rateLimitWindowMs: 5000,
    });
  });
});
