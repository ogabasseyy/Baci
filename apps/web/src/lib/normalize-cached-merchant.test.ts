import { describe, expect, it } from 'vitest';
import {
  normalizeCachedMerchantEntity,
  redactUnpublishedMerchantContactFields,
} from './normalize-cached-merchant';

describe('normalize-cached-merchant', () => {
  it('normalizes Ogabassey business type while preserving other merchants', () => {
    expect(
      normalizeCachedMerchantEntity({
        id: 'other-1',
        slug: 'other-store',
        business_type: 'fashion',
      }).business_type
    ).toBe('fashion');

    expect(
      normalizeCachedMerchantEntity({
        id: 'other-1',
        slug: 'ogabassey',
        business_type: 'fashion',
      }).business_type
    ).toBe('electronics');
  });

  it('redacts contact and legal fields only when unpublished', () => {
    const unpublished = redactUnpublishedMerchantContactFields({
      is_published: false,
      email: 'owner@example.com',
      phone: '+2348000000000',
      support_email: 'support@example.com',
      support_phone: '+2348000000001',
      business_address: '123 Street',
      legal_entity_name: 'Acme Ltd',
      registered_address: { city: 'Lagos' },
      tax_identification_number: 'TIN-123',
      trust_profile: { verified: true },
    });

    expect(unpublished.email).toBe('');
    expect(unpublished.phone).toBe('');
    expect(unpublished.legal_entity_name).toBeNull();
    expect(unpublished.trust_profile).toBeNull();

    const published = redactUnpublishedMerchantContactFields({
      is_published: true,
      email: 'owner@example.com',
      phone: '+2348000000000',
    });

    expect(published.email).toBe('owner@example.com');
    expect(published.phone).toBe('+2348000000000');
  });
});
