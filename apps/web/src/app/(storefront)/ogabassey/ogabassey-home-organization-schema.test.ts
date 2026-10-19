import { describe, expect, it } from 'vitest';
import {
  buildOrganizationGraphSchema,
  type OgabasseyMerchant,
} from './ogabassey-home-organization-schema';
import { mockSectionMerchant } from './ogabassey-home-section.test-fixtures';

function merchantWith(
  overrides: Partial<typeof mockSectionMerchant>
): OgabasseyMerchant {
  return { ...mockSectionMerchant, ...overrides } as OgabasseyMerchant;
}

describe('buildOrganizationGraphSchema', () => {
  it('emits organization and website nodes without an address', () => {
    const schema = buildOrganizationGraphSchema(merchantWith({}));

    expect(schema['@context']).toBe('https://schema.org');
    expect(schema['@graph']).toHaveLength(2);
  });

  it('adds the local-business node when the merchant has an address', () => {
    const schema = buildOrganizationGraphSchema(
      merchantWith({ business_address: '12 Allen Avenue, Ikeja' })
    );

    expect(schema['@graph']).toHaveLength(3);
  });
});
