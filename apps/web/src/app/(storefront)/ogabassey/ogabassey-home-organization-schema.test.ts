import { describe, expect, it } from 'vitest';
import { OGABASSEY_DESCRIPTION } from '@/config/ogabassey';
import {
  buildOrganizationGraphSchema,
  type OgabasseyMerchant,
} from './ogabassey-home-organization-schema';
import { mockSectionMerchant } from './ogabassey-home-section.test-fixtures';

function merchantWith(
  overrides: Partial<OgabasseyMerchant>
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

  it('falls back to OGABASSEY_DESCRIPTION when site_description and site_tagline are missing', () => {
    const schema = buildOrganizationGraphSchema(
      merchantWith({
        site_description: '',
        site_tagline: '',
      })
    );

    const orgNode = schema['@graph'].find(
      (node): node is typeof node & { description?: string } =>
        typeof node === 'object' &&
        node !== null &&
        '@type' in node &&
        node['@type'] === 'OnlineStore'
    );

    expect(orgNode?.description).toBe(OGABASSEY_DESCRIPTION);
  });

  it('sets telephone on local business data using trust profile support phone or merchant phone', () => {
    const schemaWithSupportPhone = buildOrganizationGraphSchema(
      merchantWith({
        business_address: '12 Allen Avenue, Ikeja',
        phone: '+2348011111111',
        support_phone: '+2348099999999',
      })
    );

    const localBusiness = schemaWithSupportPhone['@graph'].find(
      (node): node is typeof node & { telephone?: string } =>
        typeof node === 'object' &&
        node !== null &&
        '@type' in node &&
        node['@type'] === 'Store'
    );

    expect(localBusiness?.telephone).toBe('+2348099999999');

    const schemaWithMerchantPhone = buildOrganizationGraphSchema(
      merchantWith({
        business_address: '12 Allen Avenue, Ikeja',
        phone: '+2348011111111',
        support_phone: null,
      })
    );

    const localBusiness2 = schemaWithMerchantPhone['@graph'].find(
      (node): node is typeof node & { telephone?: string } =>
        typeof node === 'object' &&
        node !== null &&
        '@type' in node &&
        node['@type'] === 'Store'
    );

    expect(localBusiness2?.telephone).toBe('+2348011111111');
  });
});
