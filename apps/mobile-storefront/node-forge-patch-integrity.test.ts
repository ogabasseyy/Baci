import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

// Patch-integrity guard for the node-forge RSA PKCS#1 v1.5 backport.
//
// GHSA-86w9-cpqp-85rv (CVE-2026-85393): forge's RSASSA-PKCS1-v1_5 verify
// accepted extra nested DigestAlgorithm elements because asn1.validate
// ignores extra children, enabling low-exponent signature forgery. No
// fixed release exists (1.4.0 is latest), so the PR backports upstream
// digitalbazaar/forge#1152 as patches/node-forge@1.4.0.patch, following
// the repo's patchedDependencies pattern. node-forge reaches the tree
// only via @expo/cli (mobile toolchain); no workspace source imports it,
// but the Dependabot alert can only be dismissed once the installed code
// is verifiably fixed.
//
// Without this test a patch refresh or re-resolution that drops the fix
// would pass every JS-side gate while reinstalling the vulnerable verify.
// This reproduces the exact fixed/vulnerable conditions at the JS layer.

const forgePackageJsonPath = require.resolve('node-forge/package.json');
const forgeRoot = dirname(forgePackageJsonPath);
const rsaPath = join(forgeRoot, 'lib/rsa.js');

describe('security: node-forge CVE-2026-85393 backport', () => {
  it('pins the patched node-forge version until upstream releases a fix', () => {
    // Backport of digitalbazaar/forge#1152 onto 1.4.0 (latest, no fixed
    // release). Remove this assertion together with the patch after
    // upgrading to an upstream release containing the fix.
    const pkg = JSON.parse(readFileSync(forgePackageJsonPath, 'utf8')) as {
      version?: string;
    };
    expect(pkg.version).toBe('1.4.0');
  });

  it('applies the nested-DigestAlgorithm length check and never the bare form', () => {
    expect(existsSync(rsaPath)).toBe(true);
    const source = readFileSync(rsaPath, 'utf8');

    // The fix must be applied...
    expect(source).toContain('obj.value[0].value.length !==');
    // ...and the vulnerable single-condition form must never come back.
    expect(source).not.toContain('obj.value.length !== 2) {');
  });

  it('keeps the node-forge 1.4.0 backport patch registered', () => {
    const workspaceConfig = readFileSync(
      join(__dirname, '../../pnpm-workspace.yaml'),
      'utf8'
    );
    const lockfile = readFileSync(
      join(__dirname, '../../pnpm-lock.yaml'),
      'utf8'
    );
    const patchPath = join(__dirname, '../../patches/node-forge@1.4.0.patch');
    const patchHash = lockfile.match(
      /^ {2}node-forge@1\.4\.0: ([a-f0-9]{64})$/m
    )?.[1];

    expect(workspaceConfig).toContain(
      'node-forge@1.4.0: patches/node-forge@1.4.0.patch'
    );
    expect(patchHash).toMatch(/^[a-f0-9]{64}$/);
    expect(lockfile).toContain(`node-forge@1.4.0(patch_hash=${patchHash})`);
    expect(existsSync(patchPath)).toBe(true);
    expect(readFileSync(patchPath, 'utf8')).toContain(
      'obj.value[0].value.length !=='
    );
  });
});
