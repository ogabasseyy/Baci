import { describe, expect, it } from 'vitest';
import { prefundedCardCheckoutFixture } from '@/lib/piggyvest/prefunded-card-checkout.test-fixture';
import { prefundedCardCheckoutSchemas as schemas } from './prefunded-card-checkout';

const fixture = prefundedCardCheckoutFixture();

describe('first-card checkout contracts', () => {
  it('requires consent to the contribution and saving the card', () => {
    expect(schemas.request.parse(fixture.request)).toEqual(fixture.request);
    for (const consent of [
      undefined,
      { ...fixture.request.consent, saveCard: false },
      { ...fixture.request.consent, oneTimeCharge: false },
    ]) {
      expect(
        schemas.request.safeParse({ ...fixture.request, consent }).success
      ).toBe(false);
    }
  });

  it('refuses customer-supplied provider identifiers and fractional kobo', () => {
    expect(
      schemas.request.safeParse({ ...fixture.request, reference: 'injected' })
        .success
    ).toBe(false);
    for (const amountKobo of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        schemas.request.safeParse({ ...fixture.request, amountKobo }).success
      ).toBe(false);
    }
  });

  it('pins a first-card reference to its reserved intent', () => {
    expect(schemas.intent.parse(fixture.intent)).toEqual(fixture.intent);
    expect(
      schemas.intent.safeParse({
        ...fixture.intent,
        reference: `pvb-first-${fixture.intent.goalId}`,
      }).success
    ).toBe(false);
  });

  it('rejects production identities, live keys and alternate callbacks', () => {
    const settings = {
      ...fixture.scope,
      paystackSecret: 'sk_test_synthetic',
      callbackUrl: 'https://staging.ogabassey.com/savings/card-return',
    };
    expect(schemas.providerSettings.safeParse(settings).success).toBe(true);
    for (const override of [
      { deployment: 'production' },
      { systemIdentifier: '999' },
      { expiresAt: '2026-09-30T15:59:10Z' },
      { paystackSecret: 'sk_live_synthetic' },
      { callbackUrl: 'https://attacker.example/return' },
    ])
      expect(
        schemas.providerSettings.safeParse({ ...settings, ...override }).success
      ).toBe(false);
  });

  it('refuses non-checkout URLs and unverified card evidence', () => {
    for (const authorizationUrl of [
      'http://checkout.paystack.com/token',
      'https://checkout.paystack.com.attacker.example/token',
      'https://checkout.paystack.com/token?redirect=elsewhere',
      'https://user@checkout.paystack.com/token',
    ]) {
      expect(
        schemas.session.safeParse({ ...fixture.session, authorizationUrl })
          .success
      ).toBe(false);
    }
    expect(schemas.collection.safeParse(fixture.collection).success).toBe(true);
    expect(
      schemas.collection.safeParse({
        ...fixture.collection,
        providerTransactionId: '18446744073709551616',
      }).success
    ).toBe(false);
    expect(
      schemas.collection.safeParse({
        ...fixture.collection,
        authorization: { ...fixture.collection.authorization, reusable: false },
      }).success
    ).toBe(false);
  });

  it('rejects malformed provider transaction IDs without throwing during safeParse', () => {
    for (const providerTransactionId of [
      'not-an-id',
      '',
      '1.5',
      '0',
      '-1',
      '01',
      '18446744073709551616',
    ]) {
      expect(
        schemas.collection.safeParse({
          ...fixture.collection,
          providerTransactionId,
        }).success
      ).toBe(false);
    }
    expect(
      schemas.collection.safeParse({
        ...fixture.collection,
        providerTransactionId: '18446744073709551615',
      }).success
    ).toBe(true);
  });

  it('rejects embedded ASCII control characters in card brands without rejecting Unicode', () => {
    for (const characterCode of [0, 9, 10, 31, 127]) {
      expect(
        schemas.collection.safeParse({
          ...fixture.collection,
          authorization: {
            ...fixture.collection.authorization,
            brand: `Visa${String.fromCharCode(characterCode)}Debit`,
          },
        }).success
      ).toBe(false);
    }
    expect(
      schemas.collection.safeParse({
        ...fixture.collection,
        authorization: {
          ...fixture.collection.authorization,
          brand: 'Visa Débit',
        },
      }).success
    ).toBe(true);
  });
});
