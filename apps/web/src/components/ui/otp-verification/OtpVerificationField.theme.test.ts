import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('OTP status theme', () => {
  it('uses semantic storefront overrides for success and error surfaces', () => {
    const css = readFileSync(
      'src/components/ui/otp-verification/OtpVerificationField.module.css',
      'utf8'
    );
    expect(css).toContain('var(--store-success-border,');
    expect(css).toContain('var(--store-success-text,');
    expect(css).toContain('var(--store-success-bg,');
    expect(css).toMatch(/var\(\s*--store-danger-border,/);
    expect(css).toContain('var(--store-danger-bg,');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });
});
