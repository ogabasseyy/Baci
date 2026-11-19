import { expect, it } from 'vitest';
import { createOwnerVerificationSlots } from './owner-verification-slots';

it('allows one public observer and leaves capacity for another owner to attest', () => {
  const reserve = createOwnerVerificationSlots();
  const first = reserve('owner-a', 'public');
  expect(first).toBeTypeOf('function');
  expect(reserve('owner-b', 'public')).toBeNull();
  const attest = reserve('owner-b', 'attest');
  expect(attest).toBeTypeOf('function');
  first?.();
  expect(reserve('owner-c', 'public')).toBeTypeOf('function');
  attest?.();
});
