import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { seedFixtureOutput } from './seed-output';
import { storefrontFixture } from './storefront-fixture';

it('seeds the exact freshly supplied compiled storefront rather than a saved bundle', async () => {
  const query = vi.fn(async (_sql: string, _values: unknown[]) => ({
    rows: [],
  }));
  const javascript = 'synthetic freshly built javascript';
  const css = 'body{color:red}';
  const compiled = {
    javascript,
    css,
    digest: createHash('sha256').update(`${javascript}\0${css}`).digest('hex'),
    hostOrigin: 'http://127.0.0.1:43174',
    imports: [],
  };
  await seedFixtureOutput({ pool: { query } } as never, 'synthetic-merchant', {
    manifest: storefrontFixture(),
    compiled,
  });
  const written = query.mock.calls.find(
    ([sql, values]) =>
      typeof sql === 'string' &&
      sql.includes('experience_build_files') &&
      Array.isArray(values) &&
      values[2] === 'app.js'
  );
  expect(String(written?.[1]?.[4])).toBe(javascript);
});
