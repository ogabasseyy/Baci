import { describe, expect, it } from 'vitest';
import { savingsViewFixture } from '@/lib/piggyvest/savings-view.test-support';
import { piggyvestSavingsViewSchemas as schemas } from './piggyvest-savings-view';

describe('trusted savings view schemas', () => {
  it('accepts server goal context without client financial fields', () => {
    const fixture = savingsViewFixture();
    expect(schemas.configuration.safeParse(fixture.configuration).success).toBe(
      true
    );
    expect(schemas.goal.safeParse(fixture.goal).success).toBe(true);
  });
  it.each([
    { environment: 'production' },
    { actualProjectId: 'other' },
    { allowlistedCustomerIds: [] },
  ])('rejects unsafe configuration %j', (change) => {
    expect(
      schemas.configuration.safeParse({
        ...savingsViewFixture().configuration,
        ...change,
      }).success
    ).toBe(false);
  });
  it.each([
    'ledger',
    'reservation',
    'fundingReversed',
    'now',
  ])('rejects a supplied %s policy authority', (field) => {
    const goal = savingsViewFixture().goal;
    expect(
      schemas.goal.safeParse({
        ...goal,
        policy: { ...goal.policy, [field]: 'untrusted' },
      }).success
    ).toBe(false);
  });
});
