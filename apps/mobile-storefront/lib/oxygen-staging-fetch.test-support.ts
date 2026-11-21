import { readOxygenStagingProfile } from './oxygen-staging-profile';

export const profile = readOxygenStagingProfile(
  {
    apiOrigin: 'http://127.0.0.1:3000',
    authOrigin: 'https://staging-auth.example.com',
    expectedAuthIssuer: 'https://staging-auth.example.com/auth/v1',
    publicKey: `sb_publishable_${'a'.repeat(24)}`,
    merchantId: '11111111-1111-4111-8111-111111111111',
    merchantSlug: 'oxygen-test',
  },
  true
);
export const token = (issuer = profile.expectedAuthIssuer) =>
  `a.${btoa(JSON.stringify({ iss: issuer, role: 'authenticated', sub: 'user', exp: 4102444800 }))}.a`;

export const workflowLookup = [
  'select=id',
  'environment=eq.staging',
  'order_id=eq.aebdc237-5363-4e2b-b0ee-5be12ea9edab',
  'customer_id=eq.c434e49c-8a56-4a4f-82f7-2f4d0e165546',
  'merchant_id=eq.3adf89f9-67ec-4dda-9037-e691eec1ff9b',
].join('&');
