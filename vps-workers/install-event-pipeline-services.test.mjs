import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(root, 'install-event-pipeline-services.sh'), 'utf8');

test('legacy event user-unit installer is retired and cannot recreate home locks', () => {
  assert.match(source, /Refusing to install legacy Baci event-pipeline user units/);
  assert.match(source, /exit 1/);
  assert.doesNotMatch(source, /mkdir|systemctl --user enable|REMOTE_DIR\/locks/);
});
