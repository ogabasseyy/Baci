import { describe, expect, it } from 'vitest';
import {
  decryptGiglToken,
  encryptGiglToken,
} from './gigl-tracking-cache-crypto';

describe('GIGL cache authentication', () => {
  it('rejects a truncated GCM authentication tag even outside schema validation', async () => {
    const credentials = {
      baseUrl: 'https://example.test',
      email: 'synthetic@example.test',
      password: 'synthetic-password',
    };
    const token = {
      token: 'synthetic-token',
      userChannelCode: 'channel',
      customerType: 1,
      expiresAt: 1_800_000_000_000,
    };
    const encrypted = await encryptGiglToken(credentials, token);
    await expect(decryptGiglToken(credentials, encrypted)).resolves.toEqual(
      token
    );
    await expect(
      decryptGiglToken(credentials, {
        ...encrypted,
        tag: encrypted.tag.slice(0, 24),
      })
    ).rejects.toThrow();
  });
});
