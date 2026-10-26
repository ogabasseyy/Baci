import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

const tokensSchema = z
  .object({
    accessToken: z.string().min(1).max(32768),
    refreshToken: z.string().min(1).max(32768),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type UpstreamTokens = z.infer<typeof tokensSchema>;
export interface VaultBinding {
  connectionId: string;
  actorUserId: string;
}
export interface SealedSession {
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
}
/** Keys are supplied by private server configuration; never accepted in requests. */
export function createSessionVault(config: {
  activeKeyId: string;
  keys: ReadonlyMap<string, Uint8Array>;
}) {
  const keys = new Map(
    [...config.keys].map(([id, key]) => [id, Buffer.from(key)])
  );
  if (
    !keys.has(config.activeKeyId) ||
    [...keys.values()].some((key) => key.byteLength !== 32)
  )
    throw new Error('Invalid vault configuration');
  const aad = (keyId: string, b: VaultBinding) =>
    Buffer.from(
      JSON.stringify([
        'baci.builder.upstream.v1',
        keyId,
        b.connectionId,
        b.actorUserId,
      ])
    );
  return {
    seal(tokens: UpstreamTokens, b: VaultBinding): SealedSession {
      const keyId = config.activeKeyId;
      const iv = randomBytes(12);
      const key = keys.get(keyId);
      if (!key) throw new Error('Missing active vault key');
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad(keyId, b));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(tokensSchema.parse(tokens)), 'utf8'),
        cipher.final(),
      ]);
      return {
        keyId,
        iv: iv.toString('base64url'),
        tag: cipher.getAuthTag().toString('base64url'),
        ciphertext: ciphertext.toString('base64url'),
      };
    },
    open(sealed: SealedSession, b: VaultBinding): UpstreamTokens {
      try {
        const key = keys.get(sealed.keyId);
        if (!key || sealed.ciphertext.length > 100000)
          throw new Error('Invalid envelope');
        const decipher = createDecipheriv(
          'aes-256-gcm',
          key,
          Buffer.from(sealed.iv, 'base64url')
        );
        decipher.setAAD(aad(sealed.keyId, b));
        decipher.setAuthTag(Buffer.from(sealed.tag, 'base64url'));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(sealed.ciphertext, 'base64url')),
          decipher.final(),
        ]);
        return tokensSchema.parse(JSON.parse(plaintext.toString('utf8')));
      } catch {
        throw new Error('Reconnect Baci to continue.');
      }
    },
  };
}
