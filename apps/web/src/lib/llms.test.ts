import { describe, expect, it } from 'vitest';
import { buildLlmsText, createLlmsResponse, detectLlmsSurface } from './llms';

describe('detectLlmsSurface()', () => {
  it('treats the root domain as the platform surface', () => {
    expect(detectLlmsSurface('usebaci.com', 'usebaci.com')).toBe(
      'platform-admin'
    );
  });

  it('treats localhost as the platform surface', () => {
    expect(detectLlmsSurface('localhost:3000', 'usebaci.com')).toBe(
      'platform-admin'
    );
  });

  it('treats merchant domains as storefronts', () => {
    expect(detectLlmsSurface('ogabassey.com', 'usebaci.com')).toBe(
      'merchant-storefront'
    );
  });

  it('prefers proxy merchant headers over hostname heuristics', () => {
    const headers = new Headers({ 'x-merchant-slug': 'ogabassey' });

    expect(
      detectLlmsSurface('preview.vercel.app', 'usebaci.com', headers)
    ).toBe('merchant-storefront');
  });
});

describe('buildLlmsText()', () => {
  it('builds platform-oriented content for the root domain', () => {
    const result = buildLlmsText(
      'usebaci.com',
      'https://usebaci.com',
      false,
      new Headers()
    );

    expect(result).toContain('# Baci Admin');
    expect(result).toContain('https://usebaci.com/dashboard');
    expect(result).toContain('https://usebaci.com/openapi.json');
    expect(result).toContain('## Read-Only Guidance');
  });

  it('builds storefront-oriented content for merchant domains', () => {
    const result = buildLlmsText(
      'ogabassey.com',
      'https://ogabassey.com',
      false,
      new Headers({ 'x-custom-domain': 'ogabassey.com' })
    );

    expect(result).toContain('# Baci Storefront');
    expect(result).toContain('https://ogabassey.com/cart');
    expect(result).toContain('https://ogabassey.com/sitemap.xml');
    expect(result).not.toContain('https://ogabassey.com/dashboard');
    expect(result).toContain('## Route Patterns');
    expect(result).toContain(
      '- `/{category}/brands/{brandSlug}`: Brand authority hub with curated model families, price bands, and comparisons'
    );
    expect(result).toContain(
      '- `/{category}/brands/{brandSlug}/families/{familySlug}`: Model family authority hub for a specific product generation'
    );
    expect(result).toContain(
      '- `/{category}/compare/{comparisonSlug}`: Side-by-side product or brand comparison page with structured specs'
    );
    expect(result).toContain(
      '- `/{category}/best-under/{priceBandSlug}`: Budget-segmented buying guide and product rankings'
    );
  });

  it('includes machine-readable commerce links for storefront hosts', () => {
    const result = buildLlmsText(
      'ogabassey.com',
      'https://ogabassey.com',
      true,
      new Headers({ 'x-custom-domain': 'ogabassey.com' })
    );

    expect(result).toContain('## Machine-Readable Commerce');
    expect(result).toContain('https://ogabassey.com/agent-commerce.json');
    expect(result).toContain('Agent Commerce Manifest');
    expect(result).toContain('https://ogabassey.com/agent-trust.json');
    expect(result).toContain('Agent Trust Readiness');
    expect(result).toContain('https://ogabassey.com/feeds/openai.jsonl');
    expect(result).toContain('OpenAI Product Feed');
    expect(result).toContain(
      'https://ogabassey.com/feeds/agent-products.jsonl'
    );
    expect(result).toContain('Current Agent Product Feed');
    expect(result).toContain('https://ogabassey.com/feeds/google-merchant.xml');
    expect(result).toContain('Google Merchant XML Feed');
    expect(result).toContain('https://ogabassey.com/feeds/facebook.xml');
    expect(result).toContain('Facebook Catalog XML Feed');
    expect(result).toContain('https://ogabassey.com/feeds/agent-repairs.jsonl');
    expect(result).toContain('Agent Repairs Feed');
    expect(result).toContain(
      'https://ogabassey.com/feeds/facebook-repairs.xml'
    );
    expect(result).toContain('Facebook Repairs Catalog XML Feed');
    expect(result).not.toContain('/api/feed/openai');
  });

  it('adds expanded guidance in the full variant', () => {
    const result = buildLlmsText(
      'ogabassey.com',
      'https://ogabassey.com',
      true,
      new Headers({ 'x-custom-domain': 'ogabassey.com' })
    );

    expect(result).toContain('Do not trigger live checkout submissions');
    expect(result).toContain('Use the current host as canonical');
  });

  it('uses the Host header in createLlmsResponse when request.url is an internal localhost URL', async () => {
    const request = new Request('http://localhost:3000/llms.txt', {
      headers: { host: 'ogabassey.com' },
    });

    const response = createLlmsResponse(request, false);
    const body = await response.text();

    expect(body).toContain('# Baci Storefront');
    expect(body).toContain('https://ogabassey.com/sitemap.xml');
    expect(body).toContain(
      '- `/{category}/brands/{brandSlug}`: Brand authority hub with curated model families, price bands, and comparisons'
    );
  });
});
