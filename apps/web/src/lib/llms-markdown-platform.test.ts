import { describe, expect, it } from 'vitest';
import {
  buildPlatformFeaturesMarkdown,
  buildPlatformHomeMarkdown,
  buildPlatformOnboardingMarkdown,
  buildPlatformPricingMarkdown,
} from '@/lib/llms-markdown-platform';

describe('llms markdown platform builders', () => {
  it('builds the platform home mirror with canonical routes', () => {
    const result = buildPlatformHomeMarkdown('https://usebaci.com');

    expect(result).toContain('# Baci');
    expect(result).toContain('https://usebaci.com/onboarding');
    expect(result).toContain('/openapi.json');
    expect(result).not.toContain('https://usebaci.com//');
  });

  it('handles trailing slashes in the platform home mirror', () => {
    const result = buildPlatformHomeMarkdown('https://usebaci.com/');

    expect(result).toContain('# Baci');
    expect(result).toContain('https://usebaci.com/onboarding');
    expect(result).toContain('/openapi.json');
    expect(result).not.toContain('https://usebaci.com//');
  });

  it('builds the platform pricing mirror', () => {
    const result = buildPlatformPricingMarkdown('https://usebaci.com');

    expect(result).toContain('Pro: NGN 5,000 per month');
    expect(result).toContain('https://usebaci.com/onboarding');
    expect(result).not.toContain('https://usebaci.com//');
  });

  it('does not present unverified API or wholesale access as included', () => {
    const result = buildPlatformPricingMarkdown(
      'https://usebaci.com'
    ).toLowerCase();

    expect(result).not.toContain('api access');
    expect(result).not.toContain('wholesale features');
  });

  it('handles trailing slashes in the platform pricing mirror', () => {
    const result = buildPlatformPricingMarkdown('https://usebaci.com/');

    expect(result).toContain('Pro: NGN 5,000 per month');
    expect(result).toContain('https://usebaci.com/onboarding');
    expect(result).not.toContain('https://usebaci.com//');
  });

  it('builds the platform features mirror', () => {
    const result = buildPlatformFeaturesMarkdown('https://usebaci.com');

    expect(result).toContain('AI-powered store generation');
    expect(result).toContain('Jumia');
    expect(result).toContain('Domain purchase');
    expect(result).toContain('ACP');
    expect(result).toContain('UCP');
    expect(result).toContain(
      'not automatic ChatGPT or Google shopping admission'
    );
    expect(result).toContain('not a list of callable MCP tools');
    expect(result).toContain('https://usebaci.com/pricing');
    expect(result).not.toContain('https://usebaci.com//');
  });

  it('handles trailing slashes in the platform features mirror', () => {
    const result = buildPlatformFeaturesMarkdown('https://usebaci.com/');

    expect(result).toContain('AI-powered store generation');
    expect(result).toContain('https://usebaci.com/pricing');
    expect(result).not.toContain('https://usebaci.com//');
  });

  it('builds the platform onboarding mirror', () => {
    const result = buildPlatformOnboardingMarkdown('https://usebaci.com');

    expect(result).toContain('https://usebaci.com/dashboard');
    expect(result).toContain('https://usebaci.com/pricing');
    expect(result).not.toContain('https://usebaci.com//');
  });

  it('handles trailing slashes in the platform onboarding mirror', () => {
    const result = buildPlatformOnboardingMarkdown('https://usebaci.com/');

    expect(result).toContain('https://usebaci.com/dashboard');
    expect(result).toContain('https://usebaci.com/pricing');
    expect(result).not.toContain('https://usebaci.com//');
  });
});
