import { describe, expect, it } from 'vitest';
import { primaryWalletCardCheckoutFixture as fixture } from '@/lib/piggyvest/primary-wallet-card-checkout.test-fixture';
import { primaryWalletCardCheckoutSchemas as schemas } from './primary-wallet-card-checkout';

describe('primary card checkout schema', () => {
  it('accepts a goal-independent intent and one-time consent without saving a card', () => {
    expect(schemas.intent.parse(fixture.intent).consent.saveCard).toBe(false);
  });
  it.each([
    0, -1, 1.5, 10000000000,
  ])('rejects invalid kobo amount %s', (amountKobo) => {
    expect(
      schemas.intent.safeParse({ ...fixture.intent, amountKobo }).success
    ).toBe(false);
  });
  it('rejects request-selected custody or a fabricated goal', () => {
    expect(
      schemas.intent.safeParse({
        ...fixture.intent,
        goalId: fixture.intent.operationId,
      }).success
    ).toBe(false);
  });
  it('rejects production with test credentials', () => {
    expect(
      schemas.settings.safeParse({
        ...fixture.settings,
        environment: 'production',
      }).success
    ).toBe(false);
  });
  it.each([
    'http://example.test/return',
    'https://user:pass@example.test/return',
    'https://example.test/return#token',
  ])('rejects unsafe callback %s', (callbackUrl) => {
    expect(
      schemas.settings.safeParse({ ...fixture.settings, callbackUrl }).success
    ).toBe(false);
  });
  it('accepts a reference with a strict UUID tail', () => {
    expect(
      schemas.session.safeParse({
        reference: 'pvb-first-primary-10000000-0000-4000-8000-000000000005',
        authorizationUrl: 'https://checkout.paystack.com/Synthetic123',
      }).success
    ).toBe(true);
  });
  it.each([
    `pvb-first-primary-${'-'.repeat(36)}`,
    'pvb-first-primary-10000000-0000-4000-8000-00000000005',
    'pvb-first-primary-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    'pvb-first-primary-op-9',
  ])('rejects a reference with a non-UUID tail %s', (reference) => {
    expect(
      schemas.session.safeParse({
        reference,
        authorizationUrl: 'https://checkout.paystack.com/Synthetic123',
      }).success
    ).toBe(false);
  });
});
