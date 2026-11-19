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

it('allows one independent build verifier while retaining a slot for another owner', () => {
  const reserve = createOwnerVerificationSlots();
  const build = reserve('owner-a', 'build');
  expect(build).toBeTypeOf('function');
  expect(reserve('owner-b', 'build')).toBeNull();
  const other = reserve('owner-b', 'attest');
  expect(other).toBeTypeOf('function');
  build?.();
  expect(reserve('owner-c', 'build')).toBeTypeOf('function');
  other?.();
});
