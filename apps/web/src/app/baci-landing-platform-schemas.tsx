import { JsonLd } from '@/components/seo/json-ld';
import { PLATFORM_CONFIG } from '@/config/platform';
import {
  generateOrganizationSchema,
  generateWebSiteSchema,
  type OrganizationData,
} from '@/lib/seo-utils';

/**
 * Platform-level structured data using @graph pattern.
 * Only rendered on the Baci homepage — NOT on merchant storefronts.
 * Includes Organization + WebSite (the two types Google supports without ratings).
 */
export function PlatformSchemas() {
  const organizationData: OrganizationData = {
    name: PLATFORM_CONFIG.name,
    url: PLATFORM_CONFIG.url,
    logo: `${PLATFORM_CONFIG.url}${PLATFORM_CONFIG.logo}`,
    description: PLATFORM_CONFIG.description,
    socialMedia: PLATFORM_CONFIG.socialMedia,
  };

  const organizationSchema = generateOrganizationSchema(organizationData);
  const websiteSchema = generateWebSiteSchema(
    PLATFORM_CONFIG.name,
    PLATFORM_CONFIG.url,
    `${PLATFORM_CONFIG.url}/search?q={search_term_string}`
  );

  // Remove @context from individual schemas — @graph provides it once
  const { '@context': _orgCtx, ...orgWithoutContext } = organizationSchema;
  const { '@context': _wsCtx, ...wsWithoutContext } = websiteSchema;

  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@graph': [orgWithoutContext, wsWithoutContext],
      }}
    />
  );
}
