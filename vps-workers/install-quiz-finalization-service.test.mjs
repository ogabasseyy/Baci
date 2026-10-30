import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./install-quiz-finalization-service.sh', import.meta.url),
  'utf8'
);

test('legacy quiz user-unit installer is retired and cannot recreate home locks', () => {
  assert.match(source, /Refusing to install the legacy Baci quiz-finalization user unit/);
  assert.match(source, /exit 1/);
  assert.doesNotMatch(source, /mkdir|systemctl --user enable|REMOTE_DIR\/locks/);
});
