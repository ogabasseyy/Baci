import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createSourceArchive, verifySourceArchive } from './source-archive.mjs';

test('round-trips producer-valid UTF-8 archive paths', () => {
  const path = 'infra/cwv-runner/helperé.mjs';
  const bytes = Buffer.from('export {};\n');
  const archive = createSourceArchive([{ bytes, mode: '100644', path }]);
  verifySourceArchive(archive, [
    {
      blobSha256: createHash('sha256').update(bytes).digest('hex'),
      mode: '100644',
      path,
    },
  ]);
  assert.ok(archive.includes(Buffer.from('helperé.mjs')));
});
