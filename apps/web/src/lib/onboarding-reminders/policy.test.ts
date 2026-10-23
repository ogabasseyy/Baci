import type { WebStoreReadiness } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import { onboardingReminderResponseSchema } from '@/schemas/onboarding-reminder';
import { getOnboardingReminder } from './policy';

const readiness = {
  merchantId: 'merchant-1',
  surface: 'web',
  isPublished: false,
  isReady: false,
  completedRequired: 0,
  totalRequired: 1,
  completedRecommended: 0,
  totalRecommended: 0,
  overallProgress: 0,
  storeBuild: {
    starterStoreReady: true,
    aiStatus: 'not_started',
    latestJobId: null,
    canApplyAiDraft: false,
    message: 'Ready',
  },
  items: [
    {
      id: 'first_product',
      label: 'Publish your first product',
      description: 'Add a published product',
      completed: false,
      priority: 'required',
      category: 'products',
    },
  ],
} satisfies WebStoreReadiness;

describe('onboarding in-app reminders', () => {
  it('accepts the store design reminder through the client response contract', () => {
    const reminder = getOnboardingReminder({
      ...readiness,
      items: [{ ...readiness.items[0], id: 'hero_carousel' }],
    });
    expect(reminder?.href).toBe('/builder?onboarding=true');
    expect(
      onboardingReminderResponseSchema.safeParse({
        merchantId: '11111111-1111-4111-8111-111111111111',
        reminder,
      }).success
    ).toBe(true);
  });
  it.each([
    'https://example.com/dashboard',
    '//example.com/builder',
    '/builder-other',
    '/dashboard-other',
    '/builder/../external',
  ])('rejects unrelated reminder destination %s', (href) => {
    const baseline = {
      merchantId: '11111111-1111-4111-8111-111111111111',
      reminder: getOnboardingReminder(readiness),
    };
    expect(onboardingReminderResponseSchema.safeParse(baseline).success).toBe(
      true
    );
    expect(
      onboardingReminderResponseSchema.safeParse({
        ...baseline,
        reminder: { ...baseline.reminder, href },
      }).success
    ).toBe(false);
  });
  it('links directly to the next incomplete canonical setup requirement', () => {
    expect(getOnboardingReminder(readiness)).toEqual({
      id: 'first_product',
      title: 'Finish setting up your store',
      action: 'Publish your first product',
      description: 'Add a published product',
      href: '/dashboard/products?onboarding=true',
    });
  });
  it('moves on after completion and offers publication only when ready', () => {
    expect(
      getOnboardingReminder({
        ...readiness,
        isReady: true,
        items: [{ ...readiness.items[0], completed: true }],
      })
    ).toMatchObject({
      id: 'publish_store',
      action: 'Preview and publish your store',
      href: '/dashboard',
    });
  });
  it('does not remind published stores or stores still being provisioned', () => {
    expect(
      getOnboardingReminder({ ...readiness, isPublished: true })
    ).toBeNull();
    expect(
      getOnboardingReminder({
        ...readiness,
        storeBuild: {
          ...readiness.storeBuild,
          starterStoreReady: false,
        },
      })
    ).toBeNull();
  });
  it('does not invent an action when readiness is inconsistent', () => {
    expect(getOnboardingReminder({ ...readiness, items: [] })).toBeNull();
  });
});
