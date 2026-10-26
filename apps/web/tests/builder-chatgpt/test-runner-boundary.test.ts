// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps isolated native broker tests out of Vitest discovery', () => {
  const dir = new URL('../../tools/builder-auth/', import.meta.url);
  const native = readdirSync(dir).filter(
    (name) =>
      name.endsWith('.test.ts') &&
      /from ['"]node:test['"]/.test(readFileSync(new URL(name, dir), 'utf8'))
  );
  expect(native.length).toBeGreaterThan(0);
  expect(native.every((name) => name.endsWith('.node.test.ts'))).toBe(true);
  const config = readFileSync(
    new URL('../../vitest.config.ts', import.meta.url),
    'utf8'
  );
  expect(config).toContain("'tools/builder-auth/*.node.test.ts'");
  expect(config).toContain('...configDefaults.exclude');
  const manifest = JSON.parse(
    readFileSync(new URL('package.json', dir), 'utf8')
  );
  expect(manifest.scripts.test).toBe(
    'node --test --test-concurrency=1 *.node.test.ts'
  );
});

it('forwards and fingerprints the explicit local database selection through Turbo', () => {
  const config = JSON.parse(
    readFileSync(new URL('../../../../turbo.json', import.meta.url), 'utf8')
  );
  expect(config.tasks['@baci/web#test'].env).toEqual(
    expect.arrayContaining([
      'BACI_BUILDER_LOCAL_PG',
      'BACI_BUILDER_LOCAL_PG_MAJOR',
      'BACI_BUILDER_LOCAL_PG_BIN',
    ])
  );
});
