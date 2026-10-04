import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('uses the default Node runtime without Cache Components incompatible segment configuration', () => {
  const source = readFileSync(join(import.meta.dirname, 'route.ts'), 'utf8');
  expect(source).not.toMatch(/export\s+const\s+runtime\s*=/);
});
