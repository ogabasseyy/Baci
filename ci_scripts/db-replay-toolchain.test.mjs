import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('retries a failed PostgreSQL key download before installing the key', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8'
  );
  const toolchain =
    workflow
      .split('name: Install Supabase replay toolchain')[1]
      ?.split('      - name:')[0] ?? '';
  const download = toolchain.split('sudo apt-get update')[0];
  assert.match(download, /--retry 3 --retry-all-errors/);
  assert.match(download, /--output "\${PGDG_KEY}"/);
  assert.match(download, /sudo install -m 0644 "\${PGDG_KEY}"/);
});
