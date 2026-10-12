import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Modules the standalone MCP worker imports. They must stay free of
// Next.js runtime dependencies (server-only, app aliases, next/*, zod)
// so the worker can consume them without the web runtime. Bare-node
// verification: tsx --eval "import('./src/lib/cart/service.ts')...".
const WORKER_MODULES = [
  'service.ts',
  'repository.ts',
  'pricing.ts',
  'mutation-errors.ts',
  'legacy-migration.ts',
];

const BANNED_SOURCES = [
  'server-only',
  "'@/",
  '"@/',
  "'next",
  '"next',
  "'zod'",
  '"zod"',
];

describe('standalone worker boundary', () => {
  it('keeps worker modules free of web runtime imports', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const module of WORKER_MODULES) {
      const source = readFileSync(join(dir, module), 'utf8');
      for (const banned of BANNED_SOURCES) {
        expect(
          source.includes(banned),
          `${module} must not import ${banned}`
        ).toBe(false);
      }
    }
  });
});
