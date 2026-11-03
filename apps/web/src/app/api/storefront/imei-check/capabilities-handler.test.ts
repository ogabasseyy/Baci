import { expect, it, vi } from 'vitest';
import type { ImeiCapabilitiesConfiguration } from '@/lib/imei-capabilities';
import { createImeiCapabilitiesHandler } from './capabilities-handler';

vi.mock('server-only', () => ({}));
const configuration: ImeiCapabilitiesConfiguration = {
  getAccessSigningSecret: () => 's'.repeat(32),
  getImeiDisabledTierKeys: () => [],
  getImeiHashSalt: () => 'hash-salt',
  getImeiIdentifierEncryptionKey: () => undefined,
  getPetrockConfig: () => null,
  getPetrockEnabledTierKeys: () => [],
  getSickwApiKey: () => 'secret',
  isPetrockEnabled: () => false,
};

it('returns a public no-store tier-key DTO without auth or money operations', async () => {
  const response = await createImeiCapabilitiesHandler(configuration)(
    new Request(
      'https://shop.example/api/storefront/imei-check?device=smartphone&clientCapabilities=imei-async-v1'
    )
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const body = await response.json();
  expect(Object.keys(body)).toEqual(['availableTierKeys']);
  expect(body.availableTierKeys).toContain('basic');
  expect(JSON.stringify(body)).not.toContain('secret');
});

it.each([
  '?device=invalid',
  '?merchantId=tenant',
  '?__proto__=unexpected',
  '?%5F%5Fproto%5F%5F=unexpected',
  '?constructor=unexpected',
  '?device=smartphone&device=tablet',
  `?clientCapabilities=${'x'.repeat(65)}`,
  `?${Array.from({ length: 11 }, () => 'clientCapabilities=imei-async-v1').join('&')}`,
])('rejects invalid/unknown/duplicate query input before reading configuration: %s', async (query) => {
  const getImeiHashSalt = vi.fn();
  const response = await createImeiCapabilitiesHandler({
    ...configuration,
    getImeiHashSalt,
  })(new Request(`https://shop.example/api/storefront/imei-check${query}`));
  expect(response.status).toBe(400);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(getImeiHashSalt).not.toHaveBeenCalled();
});

it('fails closed with a successful empty DTO when server capability is disabled', async () => {
  const response = await createImeiCapabilitiesHandler({
    ...configuration,
    getAccessSigningSecret: () => undefined,
  })(new Request('https://shop.example/api/storefront/imei-check'));
  expect(await response.json()).toEqual({ availableTierKeys: [] });
});
