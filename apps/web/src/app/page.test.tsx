// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { safeJsonLdStringify } from '@/lib/sanitize-json-ld';
import {
  generateOrganizationSchema,
  generateWebSiteSchema,
  type OrganizationData,
} from '@/lib/seo-utils';

/**
 * Tests for the PlatformSchemas component logic rendered on the Baci homepage.
 * Verifies the @graph JSON-LD payload structure, context deduplication,
 * and correct field values.
 *
 * Uses the same schema generators as the component, with test config values
 * (avoids importing PLATFORM_CONFIG which depends on process.env).
 */
describe('PlatformSchemas JSON-LD output', () => {
  const testConfig = {
    name: 'Baci',
    url: 'https://usebaci.com',
    description: 'Create your e-commerce store in seconds with AI.',
    logo: '/baci-logo.svg',
    socialMedia: {
      twitter: 'https://twitter.com/usebaci',
      linkedin: 'https://linkedin.com/company/usebaci',
      instagram: 'https://instagram.com/usebaci',
    },
  };

  const organizationData: OrganizationData = {
    name: testConfig.name,
    url: testConfig.url,
    logo: `${testConfig.url}${testConfig.logo}`,
    description: testConfig.description,
    socialMedia: testConfig.socialMedia,
  };

  const organizationSchema = generateOrganizationSchema(organizationData);
  const websiteSchema = generateWebSiteSchema(
    testConfig.name,
    testConfig.url,
    `${testConfig.url}/search?q={search_term_string}`
  );

  const { '@context': _orgCtx, ...orgWithoutContext } = organizationSchema;
  const { '@context': _wsCtx, ...wsWithoutContext } = websiteSchema;

  const graphPayload = {
    '@context': 'https://schema.org',
    '@graph': [orgWithoutContext, wsWithoutContext],
  };

  const serialized = safeJsonLdStringify(graphPayload);
  const parsed = JSON.parse(serialized);

  it('has a single top-level @context', () => {
    expect(parsed['@context']).toBe('https://schema.org');
  });

  it('contains an @graph array with exactly two entries', () => {
    expect(Array.isArray(parsed['@graph'])).toBe(true);
    expect(parsed['@graph']).toHaveLength(2);
  });

  it('does not include @context on individual graph entries', () => {
    for (const entry of parsed['@graph']) {
      expect(entry).not.toHaveProperty('@context');
    }
  });

  it('first entry is OnlineStore with correct fields', () => {
    const org = parsed['@graph'][0];
    expect(org['@type']).toBe('OnlineStore');
    expect(org.name).toBe(testConfig.name);
    expect(org.url).toBe(testConfig.url);
    expect(org.description).toBe(testConfig.description);
    expect(org.logo).toBeDefined();
    expect(org.logo.url).toContain(testConfig.logo);
  });

  it('second entry is WebSite with SearchAction', () => {
    const ws = parsed['@graph'][1];
    expect(ws['@type']).toBe('WebSite');
    expect(ws.name).toBe(testConfig.name);
    expect(ws.url).toBe(testConfig.url);
    expect(ws.potentialAction).toBeDefined();
    expect(ws.potentialAction['@type']).toBe('SearchAction');
    expect(ws.potentialAction.target.urlTemplate).toContain(
      'search?q={search_term_string}'
    );
  });

  it('serialized output is a valid JSON string', () => {
    expect(typeof serialized).toBe('string');
    expect(() => JSON.parse(serialized)).not.toThrow();
  });

  it('does not contain SoftwareApplication or MobileApplication', () => {
    expect(serialized).not.toContain('SoftwareApplication');
    expect(serialized).not.toContain('MobileApplication');
  });
});

describe('Baci landing page font', () => {
  it('wraps the public landing page with AppSansFont instead of the storefront Arial fallback', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'),
      'utf8'
    );

    expect(source).toContain(
      "import { AppSansFont } from '@/app/app-sans-font'"
    );
    expect(source).toMatch(/<AppSansFont>\s*<AppBody showPlatformAnalytics>/);
  });
});
