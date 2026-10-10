import { describe, expect, it } from 'vitest';
import { piggyvestWalletMappingSchemas } from './piggyvest-wallet-mapping';

describe('piggyvestWalletMappingSchemas', () => {
  it('accepts only provider identities in lookup input', () => {
    expect(
      piggyvestWalletMappingSchemas.input.safeParse({
        providerWalletId: 'synthetic-wallet',
        providerCustomerId: 'synthetic-customer',
      }).success
    ).toBe(true);
  });
  it.each([
    '',
    '\0',
    '\ud800',
    'é'.repeat(257),
  ])('rejects provider IDs that cannot be persisted unchanged', (value) => {
    expect(
      piggyvestWalletMappingSchemas.input.safeParse({
        providerWalletId: value,
        providerCustomerId: 'synthetic-customer',
      }).success
    ).toBe(false);
  });
  it('rejects body-provided merchant or local goal authority', () => {
    expect(
      piggyvestWalletMappingSchemas.input.safeParse({
        providerWalletId: 'synthetic-wallet',
        providerCustomerId: 'synthetic-customer',
        merchantId: 'untrusted',
        goalId: 'untrusted',
      }).success
    ).toBe(false);
  });
  it('rejects production configuration', () => {
    expect(
      piggyvestWalletMappingSchemas.configuration.safeParse({
        environment: 'production',
        integrationId: '00000000-0000-4000-8000-000000000001',
        expectedMerchantId: '00000000-0000-4000-8000-000000000002',
      }).success
    ).toBe(false);
  });
});
