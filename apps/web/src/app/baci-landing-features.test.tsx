import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('BaciLandingFeatures', () => {
  it('keeps Features and How It Works as dedicated landing sections', () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        'baci-landing-features.tsx'
      ),
      'utf8'
    );

    expect(source).toContain('export function BaciLandingFeatures()');
    expect(source).toContain('id="features"');
    expect(source).toContain('id="how-it-works"');
    expect(source.split('\n').length).toBeLessThanOrEqual(300);
  });
});
