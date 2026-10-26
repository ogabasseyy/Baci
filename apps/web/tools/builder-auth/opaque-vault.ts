import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SealedSession } from './session-vault.ts';
/** Provider models can contain codes/tokens; encrypt every payload before SQL. */
export function createOpaqueVault(
  activeKeyId: string,
  configuredKeys: ReadonlyMap<string, Uint8Array>
) {
  const keys = new Map(
    [...configuredKeys].map(([id, key]) => [id, Buffer.from(key)])
  );
  if (!keys.has(activeKeyId) || [...keys.values()].some((k) => k.length !== 32))
    throw new Error('Invalid vault keys');
  return {
    seal(value: unknown, binding: string): SealedSession {
      const iv = randomBytes(12);
      const key = keys.get(activeKeyId);
      if (!key) throw new Error('Missing active vault key');
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(
        Buffer.from(
          JSON.stringify(['baci.builder.provider.v1', activeKeyId, binding])
        )
      );
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value)),
        cipher.final(),
      ]);
      return {
        keyId: activeKeyId,
        iv: iv.toString('base64url'),
        tag: cipher.getAuthTag().toString('base64url'),
        ciphertext: ciphertext.toString('base64url'),
      };
    },
    open(sealed: SealedSession, binding: string): unknown {
      try {
        const key = keys.get(sealed.keyId);
        if (!key || sealed.ciphertext.length > 1048576)
          throw new Error('Invalid envelope');
        const decipher = createDecipheriv(
          'aes-256-gcm',
          key,
          Buffer.from(sealed.iv, 'base64url')
        );
        decipher.setAAD(
          Buffer.from(
            JSON.stringify(['baci.builder.provider.v1', sealed.keyId, binding])
          )
        );
        decipher.setAuthTag(Buffer.from(sealed.tag, 'base64url'));
        return JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(sealed.ciphertext, 'base64url')),
            decipher.final(),
          ]).toString('utf8')
        ) as unknown;
      } catch {
        throw new Error('Invalid private record');
      }
    },
  };
}
