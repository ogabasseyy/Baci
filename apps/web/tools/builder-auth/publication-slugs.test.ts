// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { publicationFixture } from './publication-test-support';

let f: Awaited<ReturnType<typeof publicationFixture>>;
beforeEach(async () => {
  f = await publicationFixture();
}, 30000);
afterEach(async () => {
  await f?.close();
});
it.each([
  'a',
  'ab',
  'a'.repeat(63),
])('requests publication for canonical existing slug %s', async (slug) => {
  await f.pool.query('UPDATE merchants SET slug=$1 WHERE id=$2', [
    slug,
    f.merchantId,
  ]);
  const result = await f.request();
  expect(result.status).toBe('approval_required');
  expect(
    (
      await f.pool.query(
        'SELECT destination_url FROM builder_authorization.publication_intents WHERE id=$1',
        [result.intentId]
      )
    ).rows[0].destination_url
  ).toBe(`https://${slug}.usebaci.com`);
});
it.each([
  '-a',
  'a-',
  'a'.repeat(64),
  'a.b',
  'https://evil.test',
])('rejects malformed publication slug %s', async (slug) => {
  await f.pool.query('UPDATE merchants SET slug=$1 WHERE id=$2', [
    slug,
    f.merchantId,
  ]);
  await expect(f.request()).rejects.toThrow('INVALID_REQUEST');
  expect(
    (
      await f.pool.query(
        'SELECT count(*)::int n FROM builder_authorization.publication_intents'
      )
    ).rows[0].n
  ).toBe(0);
});
