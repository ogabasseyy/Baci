import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyPiggyvestPayloadSignature({
  payload,
  signature,
  secret,
}: {
  payload: Uint8Array;
  signature: string | null;
  secret: string | undefined;
}): boolean {
  if (!secret?.trim() || !signature || !/^[a-f0-9]{128}$/.test(signature)) {
    return false;
  }

  const expected = createHmac('sha512', secret).update(payload).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
