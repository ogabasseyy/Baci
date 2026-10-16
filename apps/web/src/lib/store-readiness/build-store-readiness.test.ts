import { SOCIAL_MEDIA_KEYS, type StoreReadinessItemId } from '@baci/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStoreLaunchReadiness } from './build-store-launch-readiness';
import {
  buildStoreReadiness,
  type StoreReadinessFacts,
} from './build-store-readiness';

type BuildStoreLaunchReadinessModule =
  typeof import('./build-store-launch-readiness');

vi.mock('./build-store-launch-readiness', async (importOriginal) => {
  const actual = await importOriginal<BuildStoreLaunchReadinessModule>();

  return {
    ...actual,
    buildStoreLaunchReadiness: vi.fn(actual.buildStoreLaunchReadiness),
  };
});

const BASE_FACTS = {
  merchantId: 'merchant-123',
  isPublished: true,
  slug: 'ready-store',
  country: 'NG',
  supportEmail: 'support@example.com',
  supportPhone: null,
  merchantEmail: null,
  merchantPhone: null,
  businessAddress: '1 Commerce Street',
  pages: {
    about: 'Our story',
    privacy: 'Privacy policy',
    terms: 'Terms and conditions',
  },
  socialMedia: { instagram: '@ready-store' },
  analyticsIds: ['G-READY'],
  activeProductCount: 5,
  totalProductCount: 8,
  kycRequired: true,
  hasVerifiedIdentity: true,
  paymentRequirement: {
    id: 'bank_account',
    label: 'Add bank account',
    description: 'Required to receive payments via Paystack',
    completed: true,
  },
  hasPublishedHero: true,
  storeBuild: {
    starterStoreReady: true,
    aiStatus: 'ready',
    latestJobId: null,
    canApplyAiDraft: true,
    message: 'Starter storefront is ready.',
  },
} satisfies StoreReadinessFacts;

function completion(
  facts: StoreReadinessFacts,
  itemId: StoreReadinessItemId
): boolean | undefined {
  return buildStoreReadiness(facts, 'web').items.find(
    (item) => item.id === itemId
  )?.completed;
}

describe('buildStoreReadiness', () => {
  afterEach(() => {
    vi.mocked(buildStoreLaunchReadiness).mockClear();
  });

  it.each([
    [
      'requires a non-empty about page',
      { pages: { about: ' ' } },
      'about_page',
      false,
    ],
    [
      'requires a non-empty privacy policy',
      { pages: { privacy: ' ' } },
      'privacy_policy',
      false,
    ],
    [
      'requires non-empty terms and conditions',
      { pages: { terms: ' ' } },
      'terms_conditions',
      false,
    ],
    [
      'requires a non-empty business address',
      { businessAddress: ' ' },
      'business_address',
      false,
    ],
    [
      'uses the published hero fact',
      { hasPublishedHero: false },
      'hero_carousel',
      false,
    ],
    [
      'requires a supported analytics or pixel ID',
      { analyticsIds: [' '] },
      'analytics',
      false,
    ],
    [
      'requires five active products for the multiple-products item',
      { activeProductCount: 4 },
      'multiple_products',
      false,
    ],
  ] as const)('%s', (_name, changes, itemId, expectedCompleted) => {
    expect(completion({ ...BASE_FACTS, ...changes }, itemId)).toBe(
      expectedCompleted
    );
  });

  it.each(
    SOCIAL_MEDIA_KEYS
  )('completes social readiness from a non-empty %s profile', (socialKey) => {
    expect(
      completion(
        {
          ...BASE_FACTS,
          socialMedia: { [socialKey]: '@ready-store' },
        },
        'social_media'
      )
    ).toBe(true);
  });

  it.each([
    ['an empty object', {}],
    ['blank story text', { story: '   ' }],
    ['empty values', { values: [] }],
    ['empty team members', { team: [] }],
    ['an empty social proof object', { social_proof: {} }],
  ])('does not complete About Us from %s', (_name, aboutPage) => {
    expect(
      completion({ ...BASE_FACTS, pages: null, aboutPage }, 'about_page')
    ).toBe(false);
  });

  it('composes the launch builder required items without adding an href', () => {
    const readiness = buildStoreReadiness(BASE_FACTS, 'web');
    const launch = buildStoreLaunchReadiness(BASE_FACTS);

    expect(
      readiness.items.filter((item) => item.priority === 'required')
    ).toEqual(launch.items);
    expect(readiness.items.every((item) => !('href' in item))).toBe(true);
  });

  it('uses the selected payment representation once in the complete payload', () => {
    const result = buildStoreReadiness(
      {
        ...BASE_FACTS,
        paymentRequirement: {
          id: 'payment_method',
          label: 'Enable a payment method',
          description: 'Pay on Delivery is enabled for customer checkout',
          completed: true,
        },
      },
      'web'
    );

    expect(result.items.map((item) => item.id)).toContain('payment_method');
    expect(result.items.map((item) => item.id)).not.toContain('bank_account');
  });

  it('filters the completed item list for mobile before recalculating every counter', () => {
    const mobile = buildStoreReadiness(BASE_FACTS, 'mobile');
    const web = buildStoreReadiness(BASE_FACTS, 'web');

    expect(mobile.surface).toBe('mobile');
    expect(mobile.merchantId).toBe(BASE_FACTS.merchantId);
    expect(mobile.items.map((item) => item.id)).not.toContain('about_page');
    expect(mobile.items.map((item) => item.id)).not.toContain('privacy_policy');
    expect(mobile.items.map((item) => item.id)).not.toContain(
      'terms_conditions'
    );
    expect(mobile.totalRequired).toBe(6);
    expect(mobile.completedRequired).toBe(6);
    expect(mobile.totalRecommended).toBe(2);
    expect(mobile.completedRecommended).toBe(2);
    expect(mobile.overallProgress).toBe(100);
    expect(web.surface).toBe('web');
    expect(web.items.map((item) => item.id)).toContain('about_page');
    expect(web.totalRecommended).toBe(5);
  });

  it('calculates overall progress from the filtered item list', () => {
    const result = buildStoreReadiness(
      {
        ...BASE_FACTS,
        hasPublishedHero: false,
        socialMedia: null,
        analyticsIds: [null],
        activeProductCount: 1,
      },
      'mobile'
    );
    const completedItems = result.items.filter((item) => item.completed).length;

    expect(result.overallProgress).toBe(
      Math.round((completedItems / result.items.length) * 100)
    );
  });

  it.each([
    'web',
    'mobile',
  ] as const)('uses the launch readiness decision on %s', (surface) => {
    const launch = {
      ...buildStoreLaunchReadiness(BASE_FACTS),
      isReady: false,
    };
    vi.mocked(buildStoreLaunchReadiness).mockReturnValueOnce(launch);

    const result = buildStoreReadiness(BASE_FACTS, surface);

    expect(result.isReady).toBe(launch.isReady);
  });
});
