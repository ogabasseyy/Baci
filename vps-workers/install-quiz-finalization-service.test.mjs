import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./install-quiz-finalization-service.sh', import.meta.url),
  'utf8'
);

test('installs one durable quiz worker using the cron fallback lock', () => {
  assert.match(source, /loginctl enable-linger/);
  assert.match(source, /quiz-finalize\.lock.*process-quiz-finalization\.sh --loop/);
  assert.match(source, /Restart=always/);
  assert.match(source, /WantedBy=default\.target/);
  assert.match(source, /systemctl --user enable --now baci-quiz-finalization\.service/);
});
