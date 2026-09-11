import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('landing-page-route', () => {
  it('wraps the public landing page with AppSansFont', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'landing-page-route.tsx'),
      'utf8'
    );

    expect(source).toContain(
      "import { AppSansFont } from '@/app/app-sans-font'"
    );
    expect(source).toMatch(/<AppSansFont>\s*<AppBody showPlatformAnalytics>/);
  });
});
