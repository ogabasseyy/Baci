import { describe, expect, it } from 'vitest';
import { prefundedCardCheckoutEmailSchema } from './prefunded-card-checkout-email';

describe('new first-card checkout email', () => {
  it.each([
    'baci-staging@example.com',
    'customer+staging@ogabassey.com',
  ])('accepts a public-domain test address: %s', (email) =>
    expect(prefundedCardCheckoutEmailSchema.parse(email)).toBe(email));

  it.each([
    'staging-phone@baci.invalid',
    'customer@baci.INVALID',
    'customer@example.test',
    'customer@staging.example',
    'customer@staging.localhost',
    'customer@staging.local',
    '',
    'not-an-email',
    'customer@example.com\n',
  ])('rejects an unusable checkout address before reservation: %s', (email) => {
    expect(prefundedCardCheckoutEmailSchema.safeParse(email).success).toBe(
      false
    );
  });
});
