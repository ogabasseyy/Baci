import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  encryptLikeGig,
  GIG_DOC_SAMPLE_BODY,
} from './gigl-webhook-crypto.test-support';

function decryptWithNodeReference(encrypted: string, secret: string): string {
  // GIG's documented Node.js reference implementation, verbatim in shape.
  const bytes = Buffer.from(encrypted, 'base64');
  const key = pbkdf2Sync(secret, bytes.subarray(0, 16), 10_000, 32, 'sha1');
  const decipher = createDecipheriv('aes-256-cbc', key, bytes.subarray(16, 32));
  return Buffer.concat([
    decipher.update(bytes.subarray(32)),
    decipher.final(),
  ]).toString('utf8');
}

describe('encryptLikeGig', () => {
  it("produces payloads GIG's reference decryptor reads back", () => {
    const encrypted = encryptLikeGig('{"Waybill":"1"}', 'secret');

    expect(decryptWithNodeReference(encrypted, 'secret')).toBe(
      '{"Waybill":"1"}'
    );
  });

  it('frames salt, iv and whole cipher blocks like the sample body', () => {
    const salt = Buffer.alloc(16, 1);
    const iv = Buffer.alloc(16, 2);
    const bytes = Buffer.from(
      encryptLikeGig('x', 'secret', salt, iv),
      'base64'
    );

    expect(bytes.subarray(0, 16)).toEqual(salt);
    expect(bytes.subarray(16, 32)).toEqual(iv);
    expect((bytes.length - 32) % 16).toBe(0);
    expect((Buffer.from(GIG_DOC_SAMPLE_BODY, 'base64').length - 32) % 16).toBe(
      0
    );
  });
});
