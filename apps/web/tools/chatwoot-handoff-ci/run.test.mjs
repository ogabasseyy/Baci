import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const harness = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');

test('verifies persisted pending handback before allowing the follow-up', () => {
  const statusCheck = harness.indexOf("handedBack.status !== 'pending'");
  const followupMarker = harness.indexOf(
    "harness-ready-for-followup', 'ready'"
  );

  assert.notEqual(statusCheck, -1);
  assert.notEqual(followupMarker, -1);
  assert.ok(statusCheck < followupMarker);
});
