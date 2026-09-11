import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('BaciLandingPage', () => {
  it('composes extracted features and FAQ sections under the 300-line file cap', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'baci-landing-page.tsx'),
      'utf8'
    );

    expect(source).toContain("from './baci-landing-features'");
    expect(source).toContain("from './baci-landing-faqs'");
    expect(source).toContain('<BaciLandingFeatures />');
    expect(source).toContain('<BaciLandingFaqs />');
    expect(source.split('\n').length).toBeLessThanOrEqual(300);
  });
});
