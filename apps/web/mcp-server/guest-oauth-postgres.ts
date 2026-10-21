import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { guestOAuthCipherRecordSchema } from '../src/schemas/guest-oauth';
import { GuestOAuthStorageError, type OAuthRecordStore } from './guest-oauth-records';

/** Dedicated OAuth worker only; encrypted records never enter tool results. */
export function createOAuthRecordStore(options: {
  client: SupabaseClient;
  merchantId: string;
  encryptionKey: Buffer;
}): OAuthRecordStore {
  if (
    options.encryptionKey.length !== 32 ||
    !z.string().uuid().safeParse(options.merchantId).success
  )
    throw new Error('Invalid OAuth storage configuration');
  function aad(key: string) {
    return Buffer.from(`guest-oauth:v1:${options.merchantId}:${key}`);
  }
  return {
    async read(key) {
      const { data, error } = await options.client.rpc('mcp_guest_oauth_read', {
        p_merchant_id: options.merchantId,
        p_key: key,
      });
      if (error) throw new GuestOAuthStorageError();
      const record = guestOAuthCipherRecordSchema.parse(data)[0];
      if (!record) return null;
      const bytes = Buffer.from(record.ciphertext, 'base64');
      if (bytes.length < 29) throw new Error('Invalid OAuth record');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        options.encryptionKey,
        bytes.subarray(0, 12),
      );
      decipher.setAAD(aad(key));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const value: unknown = JSON.parse(
        Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'),
      );
      return {
        value,
        revision: record.revision,
        expiresAt: Date.parse(record.expires_at),
      };
    },
    async compareAndSwap(key, revision, value, expiresAt) {
      // Bounded cleanup of this tenant's expired OAuth metadata only. Never
      // purge live refresh indices: they are required for reuse detection.
      const cleanup = await options.client.rpc('mcp_guest_oauth_purge_expired', {
        p_merchant_id: options.merchantId,
      });
      if (cleanup.error) throw new GuestOAuthStorageError();
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', options.encryptionKey, iv);
      cipher.setAAD(aad(key));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final(),
      ]);
      const { data, error } = await options.client.rpc('mcp_guest_oauth_cas', {
        p_merchant_id: options.merchantId,
        p_key: key,
        p_revision: revision,
        p_ciphertext: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64'),
        p_expires_at: new Date(expiresAt).toISOString(),
      });
      if (error || typeof data !== 'boolean') throw new GuestOAuthStorageError();
      return data;
    },
  };
}
