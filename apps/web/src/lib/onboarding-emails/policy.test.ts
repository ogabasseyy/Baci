import { describe, expect, it } from 'vitest';
import { decideOnboardingEmail } from './policy';

const facts = {
  merchantId: 'm1',
  slug: 'store',
  country: 'GB',
  supportEmail: null,
  supportPhone: null,
  merchantEmail: 'owner@example.com',
  merchantPhone: null,
  activeProductCount: 0,
  totalProductCount: 0,
  kycRequired: false,
  hasVerifiedIdentity: false,
  paymentRequirement: {
    id: 'payment_method' as const,
    label: 'Enable a payment method',
    description: 'Enable checkout',
    completed: true,
  },
};
const context = {
  confirmed: true,
  enabled: true,
  deliveryEnabled: true,
  isPublished: false,
  provisioned: true,
  facts,
};
describe('merchant onboarding email policy', () => {
  it('welcomes a confirmed provisioned merchant without claiming the store is live', () => {
    expect(decideOnboardingEmail('welcome', context)).toMatchObject({
      kind: 'send',
      href: '/dashboard/products',
      action: 'Publish your first product',
    });
  });
  it('waits for provisioning and verified ownership', () => {
    expect(
      decideOnboardingEmail('welcome', { ...context, provisioned: false })
    ).toEqual({ kind: 'defer' });
    expect(
      decideOnboardingEmail('welcome', { ...context, confirmed: false })
    ).toEqual({ kind: 'defer' });
  });
  it('suppresses follow-ups after publication or opt-out', () => {
    expect(
      decideOnboardingEmail('day1', { ...context, isPublished: true })
    ).toEqual({ kind: 'skip' });
    expect(
      decideOnboardingEmail('welcome', { ...context, enabled: false })
    ).toEqual({ kind: 'skip' });
  });
  it('does not remind someone to add a product they already added', () => {
    expect(
      decideOnboardingEmail('day1', {
        ...context,
        facts: { ...facts, activeProductCount: 1 },
      })
    ).toEqual({ kind: 'skip' });
  });
  it('uses the actual missing requirement and suppresses obsolete launch blockers', () => {
    expect(decideOnboardingEmail('day3', context)).toMatchObject({
      action: 'Publish your first product',
    });
    expect(
      decideOnboardingEmail('day3', {
        ...context,
        facts: { ...facts, activeProductCount: 1 },
      })
    ).toEqual({ kind: 'skip' });
  });
  it('only nudges publication when required setup is complete', () => {
    expect(decideOnboardingEmail('day5', context)).toEqual({ kind: 'skip' });
    expect(
      decideOnboardingEmail('day5', {
        ...context,
        facts: { ...facts, activeProductCount: 1 },
      })
    ).toMatchObject({ kind: 'send', action: 'Preview and publish your store' });
  });
  it('offers setup help on day 7 without sales promises', () => {
    expect(decideOnboardingEmail('day7', context)).toMatchObject({
      kind: 'send',
      href: '/dashboard',
    });
  });
});
