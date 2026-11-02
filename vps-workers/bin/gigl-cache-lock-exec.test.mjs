import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('GIGL lock launcher enforces contention and safe fallback', () => {
  const probe = fileURLToPath(
    new URL('../../tools/test/gigl-lock-exec.test.py', import.meta.url)
  );
  execFileSync('python3', [probe], { encoding: 'utf8', timeout: 30000 });
});
