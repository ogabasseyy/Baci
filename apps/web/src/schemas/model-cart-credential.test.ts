import { expect, it } from 'vitest';
import { modelCartCredentialSchema } from './model-cart-credential';

it('accepts only a canonical unpadded 32-byte credential', () => {
  expect(modelCartCredentialSchema.safeParse('A'.repeat(43)).success).toBe(
    true
  );
  expect(
    modelCartCredentialSchema.safeParse(`${'A'.repeat(42)}B`).success
  ).toBe(false);
  expect(
    modelCartCredentialSchema.safeParse(`${'A'.repeat(43)}=`).success
  ).toBe(false);
});
