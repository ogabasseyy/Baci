import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const consumers = new URL('./retire-ollama-consumers.sh', import.meta.url);

test('defines bind-directory consumers exactly once', async () => {
  const source = await readFile(consumers, 'utf8');
  const definitions = source.match(/container_bind_directory_consumers\(\)\s*\{/g) ?? [];

  assert.equal(
    definitions.length,
    1,
    'the bind-directory consumer implementation must not be shadowed'
  );
});
