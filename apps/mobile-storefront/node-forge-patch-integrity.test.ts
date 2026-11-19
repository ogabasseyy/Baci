import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

const packagePath = require.resolve('node-forge/package.json');

// Upstream 1.4.1 supersedes the local RSA backport and fixes eleven newer
// advisories. The companion RSA behavior test retains the forged-signature vector.
describe('node-forge upstream security fixes', () => {
  it('installs the patched upstream release', () => {
    expect(JSON.parse(readFileSync(packagePath, 'utf8')).version).toBe('1.4.1');
  });
  it('retains canonical DER validation for RSA DigestInfo', () => {
    const source = readFileSync(
      join(dirname(packagePath), 'lib/rsa.js'),
      'utf8'
    );
    expect(source).toContain('_encodeDigestInfo(oid, capture.digest, true)');
    expect(source).toContain(
      'd.substring(0, withParameters.length) !== withParameters'
    );
  });
});
