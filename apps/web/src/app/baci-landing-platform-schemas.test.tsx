import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('PlatformSchemas', () => {
  it('lives in its own module so the landing page keeps one primary component', () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        'baci-landing-platform-schemas.tsx'
      ),
      'utf8'
    );

    expect(source).toContain('export function PlatformSchemas');
    expect(source).toContain('@graph');
    expect(source.split('\n').length).toBeLessThanOrEqual(300);
  });
});
