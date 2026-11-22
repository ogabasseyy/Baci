import {
  assertOxygenCapabilities,
  readOxygenStagingProfile,
} from './oxygen-staging-profile';

const profileInput = {
  apiOrigin: 'http://127.0.0.1:3000',
  authOrigin: 'https://staging-auth.example.com',
  expectedAuthIssuer: 'https://staging-auth.example.com/auth/v1',
  publicKey: `sb_publishable_${'a'.repeat(24)}`,
  merchantId: '11111111-1111-4111-8111-111111111111',
  merchantSlug: 'oxygen-test',
};
const capability = {
  schemaVersion: 1,
  environment: 'staging',
  authOrigin: profileInput.authOrigin,
  merchant: { id: profileInput.merchantId, slug: profileInput.merchantSlug },
  mobileEnabled: true,
  reason: null,
  hostedOrigins: [],
  selfieOrigins: [],
};
const owner = {
  userId: 'user',
  customer: { user_id: 'user', merchant_id: profileInput.merchantId },
};
test('profile requires development and independent canonical issuer', () => {
  expect(() => readOxygenStagingProfile(profileInput, false)).toThrow();
  expect(() =>
    readOxygenStagingProfile(
      { ...profileInput, expectedAuthIssuer: 'https://other.com/auth/v1' },
      true
    )
  ).toThrow();
  const profile = readOxygenStagingProfile(profileInput, true);
  expect(profile.storagePrefix).toContain('oxygen-staging');
  expect(profile.storagePrefix).not.toBe(
    readOxygenStagingProfile({ ...profileInput, merchantSlug: 'other' }, true)
      .storagePrefix
  );
});
test('capabilities require hydrated matching customer; disabled initiation preserves owned reads', () => {
  const profile = readOxygenStagingProfile(profileInput, true);
  expect(() =>
    assertOxygenCapabilities(
      profile,
      capability,
      { userId: null, customer: null },
      true
    )
  ).toThrow('linked staging customer');
  expect(() =>
    assertOxygenCapabilities(
      profile,
      capability,
      { ...owner, customer: { ...owner.customer, merchant_id: 'foreign' } },
      true
    )
  ).toThrow();
  expect(() =>
    assertOxygenCapabilities(
      profile,
      { ...capability, environment: 'production' },
      owner,
      false
    )
  ).toThrow();
  expect(() =>
    assertOxygenCapabilities(
      profile,
      { ...capability, mobileEnabled: false },
      owner,
      true
    )
  ).toThrow();
  expect(
    assertOxygenCapabilities(
      profile,
      { ...capability, mobileEnabled: false },
      owner,
      false
    ).mobileEnabled
  ).toBe(false);
});

test('capabilities confirm the independent Auth base URL before permitting gateway use', () => {
  const authOrigin = 'http://127.0.0.1:3000';
  const authBaseUrl = `${authOrigin}/qa-backend`;
  const key = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ iss: 'supabase', role: 'anon', exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=/g, '')}.synthetic-signature`;
  const profile = readOxygenStagingProfile(
    {
      ...profileInput,
      authOrigin,
      authBaseUrl,
      publicKey: key,
      expectedAuthIssuer: 'supabase',
    },
    true
  );
  const localCaps = { ...capability, authOrigin, authBaseUrl };
  expect(() =>
    assertOxygenCapabilities(profile, localCaps, owner, true)
  ).not.toThrow();
  const { authBaseUrl: _omitted, ...missingBase } = localCaps;
  expect(() =>
    assertOxygenCapabilities(profile, missingBase, owner, false)
  ).toThrow();
  expect(() =>
    assertOxygenCapabilities(
      profile,
      { ...localCaps, authBaseUrl: 'http://127.0.0.1:4000/qa-backend' },
      owner,
      false
    )
  ).toThrow();
});
