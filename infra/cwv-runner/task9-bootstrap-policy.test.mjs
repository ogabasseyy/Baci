import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { authorizeTask9Bundle, readBundleFiles } from './task9-bootstrap.mjs';
import { createExactBootstrapBundle } from './task9-bootstrap-runtime-fixture.mjs';

const owner = process.getuid();

test('authorizes the reviewed pretty-formatted policy bytes sealed by source-manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'task9-policy-'));
  try {
    const policyBytes = Buffer.from(
      '{\n  "authority": {},\n  "supplyChain": {\n    "node": {\n      "ownerDarwinArm64Sha256": "' +
        '4'.repeat(64) +
        '"\n    }\n  },\n  "supplyChainProvenance": {\n    "node": {\n      "checksumsSha256": "' +
        '1'.repeat(64) +
        '",\n      "keyringSha256": "' +
        '2'.repeat(64) +
        '",\n      "signatureSha256": "' +
        '3'.repeat(64) +
        '"\n    }\n  }\n}\n'
    );
    const value = createExactBootstrapBundle(root, { policyBytes });
    const envelopeBytes = readFileSync(value.envelopePath);

    const authorized = authorizeTask9Bundle({
      bundleId: value.bundleId,
      envelopeBytes,
      envelopeSha256: value.envelopeSha256,
      files: readBundleFiles(value.bundleDir, owner),
      owner,
      reviewedEnvelopeSha256: value.envelopeSha256,
    });

    assert.deepEqual(
      authorized.tree.get('infra/cwv-runner/policy.json').bytes,
      policyBytes
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
