import { describe, expect, it } from 'vitest';
import {
  REDACTED_VALUE,
  sanitizePostHogProperties,
} from '@/lib/posthog/property-sanitizer';

describe('sanitizePostHogProperties', () => {
  it('returns undefined when properties are undefined', () => {
    expect(sanitizePostHogProperties(undefined)).toBeUndefined();
  });

  it('redacts sensitive property keys, emails, and URL query strings', () => {
    expect(
      sanitizePostHogProperties({
        $current_url: 'https://ogabassey.com/checkout?token=secret#frag',
        email: 'customer@example.com',
        note: 'Reach out to customer@example.com',
        route_surface: 'storefront',
      })
    ).toEqual({
      $current_url: 'https://ogabassey.com/checkout',
      email: REDACTED_VALUE,
      note: `Reach out to ${REDACTED_VALUE}`,
      route_surface: 'storefront',
    });
  });
});
