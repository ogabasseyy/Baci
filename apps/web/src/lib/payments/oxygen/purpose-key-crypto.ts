import 'server-only';
import { hkdfSync } from 'node:crypto';

/** Separate keys without changing or rotating the configured root secret. */
export function oxygenPurposeKey(
  root: Buffer,
  purpose: 'form-draft' | 'residential-draft' | 'phone-handoff'
): Buffer {
  return Buffer.from(
    hkdfSync('sha256', root, Buffer.alloc(0), `oxygen:${purpose}:v2`, 32)
  );
}

/** Deploy dual readers everywhere before enabling v2 writes. */
export function oxygenWriteVersion(): 'v1' | 'v2' {
  return process.env.OXYGEN_PURPOSE_KEY_V2_WRITE === 'true' ? 'v2' : 'v1';
}
