import {
  type PortablePublishedSnapshot,
  portablePublishedSnapshotSchema,
} from '@/schemas/portable-published-snapshot';
import { portableHomeSchema } from '@/schemas/portable-storefront';
import { stableStringify } from './stable-stringify';

function freezeSnapshot(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const child of Object.values(value)) freezeSnapshot(child);
  Object.freeze(value);
}

/** Version and render data derive from one normalized, immutable public read. */
export async function createPortablePublishedSnapshot(
  config: unknown
): Promise<PortablePublishedSnapshot> {
  const normalized = portableHomeSchema.parse(config);
  const canonical = stableStringify(normalized);
  const clonedConfig = portableHomeSchema.parse(JSON.parse(canonical));
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical)
  );
  const hex = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const snapshot = { config: clonedConfig, publishedVersion: `home-v1:${hex}` };
  freezeSnapshot(snapshot);
  return snapshot;
}

export async function verifyPortablePublishedSnapshot(
  input: unknown
): Promise<PortablePublishedSnapshot> {
  const parsed = portablePublishedSnapshotSchema.parse(input);
  const verified = await createPortablePublishedSnapshot(parsed.config);
  if (verified.publishedVersion !== parsed.publishedVersion)
    throw new Error('Public snapshot version mismatch');
  return verified;
}
