import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('BaciLandingFaqs', () => {
  it('keeps the FAQ section on the public landing page', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'baci-landing-faqs.tsx'),
      'utf8'
    );

    expect(source).toContain('export function BaciLandingFaqs()');
    expect(source).toContain('id="faqs"');
    expect(source.split('\n').length).toBeLessThanOrEqual(300);
  });
});
