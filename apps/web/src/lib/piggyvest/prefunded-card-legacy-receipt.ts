import 'server-only';
import { prefundedCardLegacyProofSchemas as schemas } from '@/schemas/prefunded-card-legacy-proof';
import { decryptValidatedPrefundedCardLegacyReceipt } from './prefunded-card-legacy-receipt-decrypt';

export function decryptPrefundedCardLegacyReceipt(
  input: unknown,
  key: unknown
): Buffer {
  try {
    const receipt = schemas.sealed.parse(input);
    const encryptionKey = schemas.encryptionKey.parse(key);
    return decryptValidatedPrefundedCardLegacyReceipt(receipt, encryptionKey);
  } catch {
    throw new Error('Legacy receipt refused');
  }
}
