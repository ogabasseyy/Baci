import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('./seal-source.sh', import.meta.url),
  'utf8'
);

test('pins C collation before any seal ordering validation', () => {
  const locale = source.indexOf('export LC_ALL=C');
  const firstOrderingInvocation = source.search(/"\$SORT"\s/);
  assert.match(source, /^export LC_ALL=C$/m);
  assert.notEqual(locale, -1);
  assert.notEqual(firstOrderingInvocation, -1);
  assert.ok(locale < firstOrderingInvocation);
});
