import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createSourceArchive } from './source-archive.mjs';
import { parseUstar, validSourcePath } from './task9-bootstrap.mjs';

test('accepts the complete safe source path character set', () => {
  assert.equal(validSourcePath('infra/cwv-runner/helper+v2.mjs'), true);
  assert.equal(validSourcePath('infra/cwv-runner/helperé.mjs'), true);
  assert.equal(validSourcePath('infra/cwv-runner/helper v2.mjs'), true);
  assert.equal(validSourcePath('infra/cwv-runner/../helper.mjs'), false);
});

test('sealed parser accepts producer-valid UTF-8 source archive paths', () => {
  const path = 'infra/cwv-runner/helperé.mjs';
  const bytes = Buffer.from('export {};\n');
  const archive = createSourceArchive([{ bytes, mode: '100644', path }]);
  assert.equal(
    parseUstar(archive, [
      {
        mode: '100644',
        path,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ])[0].path,
    path
  );
});
