import { describe, expect, it } from 'vitest';
import { isAgenticTenantVisible } from './agentic-tenant-navigation';

describe('isAgenticTenantVisible', () => {
  it('is visible when the merchant is the configured tenant', () => {
    expect(isAgenticTenantVisible('ogabassey', 'ogabassey')).toBe(true);
  });
  it('is hidden for another merchant', () => {
    expect(isAgenticTenantVisible('acme', 'ogabassey')).toBe(false);
  });
  it.each([
    null,
    undefined,
    '',
  ])('is hidden when no tenant is configured (%s), even for a blank slug', (configured) => {
    expect(isAgenticTenantVisible('ogabassey', configured)).toBe(false);
    expect(isAgenticTenantVisible(configured, configured)).toBe(false);
  });
  it('is hidden when the merchant slug is missing', () => {
    expect(isAgenticTenantVisible(null, 'ogabassey')).toBe(false);
    expect(isAgenticTenantVisible(undefined, 'ogabassey')).toBe(false);
  });
});
