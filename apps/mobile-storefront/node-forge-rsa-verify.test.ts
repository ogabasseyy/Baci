import { describe, expect, it } from '@jest/globals';

// Behavioral guard for the node-forge RSA PKCS#1 v1.5 backport
// (GHSA-86w9-cpqp-85rv / CVE-2026-85393). The companion
// patch-integrity test pins the backport's presence; this test proves the
// installed forge actually rejects the forged nested-DigestAlgorithm
// signature while still accepting a valid one, so neither a dropped
// backport nor a reject-everything regression can pass silently.
//
// Vectors are the upstream digitalbazaar/forge#1152 regression test
// (2048-bit key, e=3, SHA-256 over 'hello world!'): the forged S carries
// a garbage OCTET STRING as an extra unconsumed child of the nested
// DigestAlgorithm SEQUENCE. Verified locally: pristine 1.4.0 returns
// true for S (vulnerable), the backported copy throws the DigestInfo
// error (fixed).

// eslint-disable-next-line @typescript-eslint/no-require-imports
const forgeRoot = require('node-forge/package.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const forge = require('node-forge');

const forgeUtil = forge.util;
const forgeJsbn = forge.jsbn;
const forgeMd = forge.md;
const forgeRsa = forge.pki.rsa;

const N_HEX =
  'E932AC92252F585B3A80A4DD76A897C8B7652952FE788F6EC8DD640587A1EE56' +
  '47670A8AD4C2BE0F9FA6E49C605ADF77B5174230AF7BD50E5D6D6D6D28CCF0A8' +
  '86A514CC72E51D209CC772A52EF419F6A953F3135929588EBE9B351FCA61CED7' +
  '8F346FE00DBB6306E5C2A4C6DFC3779AF85AB417371CF34D8387B9B30AE46D7A' +
  '5FF5A655B8D8455F1B94AE736989D60A6F2FD5CADBFFBD504C5A756A2E6BB5CE' +
  'CC13BCA7503F6DF8B52ACE5C410997E98809DB4DC30D943DE4E812A47553DCE5' +
  '4844A78E36401D13F77DC650619FED88D8B3926E3D8E319C80C744779AC5D6AB' +
  'E252896950917476ECE5E8FC27D5F053D6018D91B502C4787558A002B9283DA7';

// Forged signature: extra nested DigestAlgorithm child (octet garbage
// after the OID and NULL). Must be rejected.
const FORGED_S_HEX =
  'a4ae63dd5e7712b78f4870d0f51e294df5503d4f16c5d27ae33370981fb57f0d' +
  'e49f50f3d6a04666774cd984cd13972db9bf8e12bd294ef0ddc916c7c86cbae6' +
  '3efd7b6b97885e69760c208a40f1aecc76a90d7af5145177efce1bb55807a8d0' +
  '5c20b1596753ba710642fc9acdde6c160232654662c77cc4466c8257a38edb49' +
  'f894e8845d0fd987b857ced88f4b62505a080bd87ef700d35d392a6e8f6fde34' +
  '250c50b86fae606cb551215e8f4813239b77651d5565ad453698c071d48c31e8' +
  'e526fb4a37610f64b3e1fb8e5be5898e408ad08197a0947794a530b54f844853' +
  '77ce4a7488ed485ce4e5e105dd89698a472f390c3b1b76bc16b73276c4d1c81d';

const MESSAGE = 'hello world!';

function forgedPublicKey() {
  const N = new forgeJsbn.BigInteger(N_HEX, 16);
  const e = new forgeJsbn.BigInteger('3');
  return forgeRsa.setPublicKey(N, e);
}

function sha256(message: string): string {
  const md = forgeMd.sha256.create();
  md.update(message, 'utf8');
  return md.digest().getBytes();
}

describe('security: node-forge CVE-2026-85393 behavior', () => {
  it('rejects the forged nested-DigestAlgorithm signature', () => {
    expect(forgeRoot.version).toBe('1.4.0');
    const publicKey = forgedPublicKey();
    const digest = sha256(MESSAGE);
    const forged = forgeUtil.binary.hex.decode(FORGED_S_HEX);
    expect(forged).toHaveLength(256);

    expect(() =>
      publicKey.verify(digest, forged, undefined, {
        _parseAllDigestBytes: true,
        _skipPaddingChecks: true,
      })
    ).toThrow(
      /^ASN\.1 object does not contain a valid RSASSA-PKCS1-v1_5 DigestInfo value\.$/
    );
  });

  it('still accepts a valid PKCS#1 v1.5 signature', () => {
    const keypair = forgeRsa.generateKeyPair({ bits: 512, e: 0x10001 });
    const md = forgeMd.sha256.create();
    md.update(MESSAGE, 'utf8');
    const signature = keypair.privateKey.sign(md);

    expect(keypair.publicKey.verify(md.digest().getBytes(), signature)).toBe(
      true
    );
  });
});
