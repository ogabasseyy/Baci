import {
  accountIdentitySchema,
  type ChowdeckAccountIdentityV1,
} from './schemas/account-identity';

function invalidIdentity(): never {
  throw new Error('Invalid account identity');
}

export function parseAccountIdentity(
  input: unknown
): ChowdeckAccountIdentityV1 {
  try {
    return accountIdentitySchema.parse(input);
  } catch {
    return invalidIdentity();
  }
}
