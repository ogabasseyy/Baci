import { describe, expect, it } from 'vitest';
import { prefundedCardCheckoutPublicContextSchemas as schemas } from './prefunded-card-checkout-public-context';

const actorId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const customerId = '10000000-0000-4000-8000-000000000001';
const merchantId = '20000000-0000-4000-8000-000000000001';
const goalId = '30000000-0000-4000-8000-000000000001';

describe('first-card checkout context projections', () => {
  it('normalizes the projected actor identity without accepting extra authority', () => {
    expect(
      schemas.actor.parse({ id: actorId, email: 'Customer@Example.com' })
    ).toEqual({ id: actorId.toLowerCase(), email: 'customer@example.com' });
    expect(
      schemas.actor.safeParse({
        id: actorId,
        email: 'customer@example.com',
        role: 'service_role',
      }).success
    ).toBe(false);
  });

  it.each([
    undefined,
    '',
    'invalid-email',
    'customer@example.test\n',
  ])('rejects an unusable authenticated email: %s', (email) => {
    expect(schemas.actor.safeParse({ id: actorId, email }).success).toBe(false);
  });

  it('requires the customer merchant and user identity columns', () => {
    const customer = {
      id: customerId,
      merchant_id: merchantId,
      user_id: actorId.toLowerCase(),
      email: 'customer@example.com',
    };
    expect(schemas.customer.parse(customer)).toEqual(customer);
    expect(
      schemas.customer.safeParse({ ...customer, user_id: null }).success
    ).toBe(false);
  });

  it('retains existing customer identities with reserved domains for payment-status recovery', () => {
    expect(
      schemas.customer.safeParse({
        id: customerId,
        merchant_id: merchantId,
        user_id: actorId.toLowerCase(),
        email: 'staging-phone@baci.invalid',
      }).success
    ).toBe(true);
  });

  it('requires complete scoped goal and merchant identities', () => {
    const goal = {
      id: goalId,
      merchant_id: merchantId,
      customer_id: customerId,
    };
    expect(schemas.goal.parse(goal)).toEqual(goal);
    expect(schemas.goal.safeParse({ id: goalId }).success).toBe(false);
    expect(schemas.merchant.parse({ id: merchantId })).toEqual({
      id: merchantId,
    });
    expect(schemas.merchant.safeParse({ id: 'not-a-uuid' }).success).toBe(
      false
    );
  });
});
