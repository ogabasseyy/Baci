import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('worker discovery limits ps to nginx and preserves full account names', async () => {
  const source = await readFile(
    new URL('./managed-nginx-owner-actions.mjs', import.meta.url),
    'utf8'
  );
  assert.equal(
    source
      .replace(/\s+/g, '')
      .split("['-C','nginx','-o','pid=,ppid=,user:32=,comm=',]").length - 1,
    2
  );
  assert.ok(!source.includes("['-eo', 'pid=,ppid=,user=,comm=']"));
});
