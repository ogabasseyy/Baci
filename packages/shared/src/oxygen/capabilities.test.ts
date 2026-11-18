import { describe, expect, it } from 'vitest';
import { oxygenMobileCapabilitiesSchema } from './capabilities';

const capabilities = {
  schemaVersion: 1,
  environment: 'staging',
  authOrigin: 'https://auth.example.test',
  merchant: { id: '690a9d2e-33b7-4106-8c68-b9019f814dce', slug: 'ogabassey' },
  mobileEnabled: true,
  reason: null,
  hostedOrigins: ['https://selfie.example.test', 'https://pay.example.test'],
  selfieOrigins: ['https://selfie.example.test'],
};

describe('mobile capabilities', () => {
  it('accepts valid staging capabilities', () => {
    expect(oxygenMobileCapabilitiesSchema.safeParse(capabilities).success).toBe(
      true
    );
  });
  it('rejects selfie hosts outside the allowed hosted origins', () => {
    expect(
      oxygenMobileCapabilitiesSchema.safeParse({
        ...capabilities,
        selfieOrigins: ['https://other.example.test'],
      }).success
    ).toBe(false);
  });
  it('rejects noncanonical origins and unknown fields', () => {
    expect(
      oxygenMobileCapabilitiesSchema.safeParse({
        ...capabilities,
        authOrigin: 'https://auth.example.test/path',
      }).success
    ).toBe(false);
    expect(
      oxygenMobileCapabilitiesSchema.safeParse({ ...capabilities, extra: true })
        .success
    ).toBe(false);
  });
});

it('accepts an independently pinned loopback Auth gateway only', () => {
  const local = {
    ...capabilities,
    authOrigin: 'http://localhost:3000',
    authBaseUrl: 'http://localhost:3000/qa-backend',
  };
  expect(oxygenMobileCapabilitiesSchema.safeParse(local).success).toBe(true);
  expect(
    oxygenMobileCapabilitiesSchema.safeParse({
      ...local,
      authBaseUrl: 'http://localhost:3000/arbitrary',
    }).success
  ).toBe(false);
  expect(
    oxygenMobileCapabilitiesSchema.safeParse({
      ...local,
      authBaseUrl: 'http://localhost:3001/qa-backend',
    }).success
  ).toBe(false);
});
