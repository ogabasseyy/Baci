import { describe, expect, it } from 'vitest';
import { primaryCardCustodyLaunchSchemas as schemas } from './primary-wallet-card-custody-launch';

describe('worker launch approval schema', () => {
  const approval = {
    approved: 'true',
    path: '/fixture/binding.json',
    sha256: 'a'.repeat(64),
    signature: 'b'.repeat(64),
    issuerKey: 'mock'.repeat(8),
  };
  it('accepts exact operator-reviewed internal delivery profile', () =>
    expect(schemas.approval.parse(approval)).toEqual(approval));
  it.each([
    { approved: 'false' },
    { path: 'relative.json' },
    { signature: 'bad' },
    { issuerKey: '' },
  ])('rejects malformed approval %#', (change) =>
    expect(schemas.approval.safeParse({ ...approval, ...change }).success).toBe(
      false
    ));
  it('rejects missing crosswalk and invented delivery contract', () =>
    expect(
      schemas.binding.safeParse({
        deliveryContract: 'provider-version',
        records: [],
      }).success
    ).toBe(false));
});
