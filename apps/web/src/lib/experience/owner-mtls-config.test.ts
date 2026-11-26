// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  configuredOwnerMtlsFetch,
  ownerMtlsEnvironment,
} from './owner-mtls-config';
import { createOwnerMtlsFetch } from './owner-mtls-fetch';

vi.mock('server-only', () => ({}));
vi.mock('./owner-mtls-fetch', () => ({ createOwnerMtlsFetch: vi.fn() }));

const createTransport = vi.mocked(createOwnerMtlsFetch);
const settings = {
  ownerOrigin: 'https://builder-owner.usebaci.com',
  ownerCert: 'synthetic-cert',
  ownerKey: 'synthetic-key',
};

beforeEach(() => {
  createTransport.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

it('constructs the transport with the configured credentials and fixed origin', () => {
  const transport = vi.fn<typeof fetch>();
  createTransport.mockReturnValue(transport);
  expect(configuredOwnerMtlsFetch(settings)).toBe(transport);
  expect(createTransport).toHaveBeenCalledExactlyOnceWith({
    origin: settings.ownerOrigin,
    cert: settings.ownerCert,
    key: settings.ownerKey,
  });
});

it.each([
  { ownerOrigin: undefined },
  { ownerOrigin: 'https://unexpected.invalid' },
  { ownerCert: undefined },
  { ownerKey: undefined },
])('rejects invalid configuration before creating a transport (%j)', (override) => {
  expect(
    configuredOwnerMtlsFetch({ ...settings, ...override })
  ).toBeUndefined();
  expect(createTransport).not.toHaveBeenCalled();
});

it('returns unavailable if transport construction throws', () => {
  createTransport.mockImplementation(() => {
    throw new Error('Invalid synthetic TLS material');
  });
  expect(configuredOwnerMtlsFetch(settings)).toBeUndefined();
  expect(createTransport).toHaveBeenCalledOnce();
});

it('reads the owner mTLS settings from the operator environment', () => {
  vi.stubEnv('BACI_OWNER_MTLS_ORIGIN', settings.ownerOrigin);
  vi.stubEnv('BACI_OWNER_MTLS_CERT', settings.ownerCert);
  vi.stubEnv('BACI_OWNER_MTLS_KEY', settings.ownerKey);
  expect(ownerMtlsEnvironment()).toEqual(settings);
});
