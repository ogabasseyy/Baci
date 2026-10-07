import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { isCustomerSavingsDraftRuntimeEnabled } from './customer-savings-draft-runtime';

const mockRead = jest.fn();

jest.mock('./hosted-storefront-runtime', () => ({
  hostedStorefrontRuntime: { read: () => mockRead() },
}));

const originalDev = (globalThis as typeof globalThis & { __DEV__?: boolean })
  .__DEV__;
const originalEnvironment = { ...process.env };

beforeEach(() => {
  Reflect.set(globalThis, '__DEV__', true);
  process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '0';
  process.env.EXPO_PUBLIC_LOCAL_STOREFRONT = '0';
  mockRead.mockReset();
});

afterEach(() => {
  Reflect.set(globalThis, '__DEV__', originalDev);
  process.env = { ...originalEnvironment };
});

describe('customer savings draft runtime gate', () => {
  it('rejects a hosted flag when the hosted runtime is not verified', () => {
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    process.env.EXPO_PUBLIC_LOCAL_STOREFRONT = '1';
    mockRead.mockImplementation(() => {
      throw new Error('runtime not verified');
    });

    expect(isCustomerSavingsDraftRuntimeEnabled()).toBe(false);
  });

  it('accepts hosted drafts only after the verified runtime is installed', () => {
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    mockRead.mockReturnValue({
      apiOrigin: 'https://staging.ogabassey.com',
      financialActivationEnabled: false,
      telemetryEnabled: false,
    });

    expect(isCustomerSavingsDraftRuntimeEnabled()).toBe(true);
  });

  it('keeps the normal production legacy path disabled for drafts', () => {
    Reflect.set(globalThis, '__DEV__', false);
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    process.env.EXPO_PUBLIC_LOCAL_STOREFRONT = '1';

    expect(isCustomerSavingsDraftRuntimeEnabled()).toBe(false);
    expect(mockRead).not.toHaveBeenCalled();
  });
});
