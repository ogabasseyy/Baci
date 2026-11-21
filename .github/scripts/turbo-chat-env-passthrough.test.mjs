import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('every chat env var read by app source is passed through turbo', () => {
  const turbo = JSON.parse(readFileSync(new URL('turbo.json', root), 'utf8'));
  const declared = new Set(turbo.globalPassThroughEnv);
  const out = execFileSync(
    'git',
    ['grep', '-hoE', '(CHATWOOT_)?EKAETTE_[A-Z_]+', '--', 'apps', 'packages', ':!*.test.*', ':!*.md'],
    { cwd: root, encoding: 'utf8' }
  );
  const used = [...new Set(out.split('\n').filter(Boolean))];
  assert.ok(used.length > 0);
  const missing = used.filter((name) => !declared.has(name));
  assert.deepEqual(missing, []);
});
