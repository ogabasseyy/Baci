import assert from 'node:assert/strict';
import test from 'node:test';
import { diffFingerprint } from './fingerprint.mjs';

const diff = (index, hunk, added = '+const a = 2;') => `diff --git a/src/a.ts b/src/a.ts
index ${index}
--- a/src/a.ts
+++ b/src/a.ts
@@ ${hunk} @@ function f() {
 context line
-const a = 1;
${added}
 more context
`;

test('is empty for an empty diff', () => {
  assert.equal(diffFingerprint(''), '');
  assert.equal(diffFingerprint('\n\n'), '');
});

test('is a 64-character hex digest otherwise', () => {
  assert.match(diffFingerprint(diff('111..222 100644', '-1,4 +1,4')), /^[0-9a-f]{64}$/);
});

test('ignores blob ids, hunk offsets and context, so a merge from main does not change it', () => {
  const before = diffFingerprint(diff('111..222 100644', '-1,4 +1,4'));
  const afterSync = diffFingerprint(diff('333..444 100644', '-41,4 +57,4').replace('context line', 'different context'));
  assert.equal(afterSync, before);
});

test('changes when an added or removed line changes', () => {
  const base = diffFingerprint(diff('111..222 100644', '-1,4 +1,4'));
  assert.notEqual(diffFingerprint(diff('111..222 100644', '-1,4 +1,4', '+const a = 3;')), base);
});

test('changes when the file path changes or a rename is introduced', () => {
  const base = diffFingerprint(diff('111..222 100644', '-1,4 +1,4'));
  assert.notEqual(diffFingerprint(diff('111..222 100644', '-1,4 +1,4').replaceAll('src/a.ts', 'src/b.ts')), base);
  const renamed = `diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
`;
  assert.notEqual(diffFingerprint(renamed), '');
});

test('tolerates CRLF line endings', () => {
  const lf = diff('111..222 100644', '-1,4 +1,4');
  assert.equal(diffFingerprint(lf.replaceAll('\n', '\r\n')), diffFingerprint(lf));
});
