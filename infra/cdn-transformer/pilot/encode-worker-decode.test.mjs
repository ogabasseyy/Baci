import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { handleMetadataOp } from './encode-worker.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', name);

test('worker metadata op rejects header-valid but truncated pixels', async () => {
  const full = await readFile(fixture('tiny-48x48.png'));
  const truncated = full.subarray(0, 60);
  // Sanity: the header still parses — this is exactly the gap, since a
  // metadata-only probe would accept these bytes.
  const meta = await sharp(truncated).metadata();
  assert.equal(meta.format, 'png');
  await assert.rejects(
    () =>
      handleMetadataOp(
        { input: 'truncated.png' },
        { readFile: async () => truncated }
      ),
    /does not fully decode/
  );
  // The intact file still probes clean through the same path.
  const result = await handleMetadataOp(
    { input: 'tiny.png' },
    { readFile: async () => full }
  );
  assert.equal(result.ok, true);
});
