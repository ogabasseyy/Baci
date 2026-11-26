import {
  DEFAULT_BRAND_COLORS,
  type OnboardingChatData,
} from '@baci/shared/onboarding-chat';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitOnboarding } from '@/app/(platform)/onboarding/actions';
import {
  trackMerchantSignupCompleted,
  trackMerchantSignupStarted,
} from '@/components/analytics/platform-analytics-provider';
import { requestWebOnboardingAssist } from './web-onboarding-chat-helpers';
import {
  runWebLogoGeneration,
  runWebNameSuggestion,
  runWebStoreLaunch,
  type StoreActionContext,
} from './web-onboarding-store-actions';

vi.mock('@/app/(platform)/onboarding/actions', () => ({
  submitOnboarding: vi.fn(),
}));

vi.mock('@/components/analytics/platform-analytics-provider', () => ({
  trackMerchantSignupStarted: vi.fn(),
  trackMerchantSignupCompleted: vi.fn(),
}));

vi.mock('./web-onboarding-chat-helpers', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./web-onboarding-chat-helpers')>();
  return {
    ...actual,
    requestWebOnboardingAssist: vi.fn(),
    uploadWebOnboardingLogo: vi.fn(),
    uploadWebDataUriLogo: vi.fn(),
  };
});

const DATA: OnboardingChatData = {
  firstName: 'Ada',
  lastName: 'Okafor',
  phone: '',
  businessName: 'Kicks Hub',
  businessType: 'fashion',
  otherBusinessType: '',
  country: 'NG',
  slug: 'kicks-hub',
  slugIsCustom: true,
  logoUrl: '',
  brandColors: DEFAULT_BRAND_COLORS,
};

function makeCtx(): StoreActionContext {
  return {
    user: { id: 'u-1', email: 'ada@example.com' } as never,
    data: DATA,
    setData: vi.fn(),
    setStep: vi.fn(),
    setSuggestedNames: vi.fn(),
    setLogoDraft: vi.fn(),
    setRejectedSlug: vi.fn(),
    setIsCustomizingSlug: vi.fn(),
    setIsBusy: vi.fn(),
    setIsLaunching: vi.fn(),
    appendMessages: vi.fn(),
  };
}

describe('web-onboarding-store-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('populates suggested names and returns to business_name step', async () => {
    vi.mocked(requestWebOnboardingAssist).mockResolvedValueOnce({
      businessNames: ['Lagos Lace', 'Sole Craft'],
    });
    const ctx = makeCtx();
    await runWebNameSuggestion('Sneakers in Lagos', ctx);

    expect(ctx.setSuggestedNames).toHaveBeenCalledWith([
      'Lagos Lace',
      'Sole Craft',
    ]);
    expect(ctx.setStep).toHaveBeenCalledWith('business_name');
  });

  it('handles empty logo response gracefully without setting a draft', async () => {
    vi.mocked(requestWebOnboardingAssist).mockResolvedValueOnce({
      logos: [],
      brandColors: DEFAULT_BRAND_COLORS,
    });
    const ctx = makeCtx();
    await runWebLogoGeneration(ctx);

    expect(ctx.setLogoDraft).not.toHaveBeenCalled();
    expect(ctx.appendMessages).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'system' })
    );
  });

  it('recovers cleanly on slug_unavailable from submitOnboarding', async () => {
    vi.mocked(submitOnboarding).mockResolvedValueOnce({
      success: false,
      code: 'slug_unavailable',
      message: 'That store link is already taken.',
    });
    const ctx = makeCtx();
    await runWebStoreLaunch(ctx);

    expect(ctx.setRejectedSlug).toHaveBeenCalledWith('kicks-hub');
    expect(ctx.setStep).toHaveBeenCalledWith('slug');
    expect(trackMerchantSignupStarted).toHaveBeenCalledWith({
      business_name: 'Kicks Hub',
      business_type: 'fashion',
    });
    expect(trackMerchantSignupCompleted).not.toHaveBeenCalled();
  });

  it('fires signup started and completed analytics on successful store launch', async () => {
    vi.mocked(submitOnboarding).mockResolvedValueOnce({
      success: true,
      message: 'Store created!',
      merchantId: 'merchant-42',
      businessName: 'Kicks Hub',
    });
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    });
    try {
      const ctx = makeCtx();
      await runWebStoreLaunch(ctx);

      expect(trackMerchantSignupStarted).toHaveBeenCalledWith({
        business_name: 'Kicks Hub',
        business_type: 'fashion',
      });
      expect(trackMerchantSignupCompleted).toHaveBeenCalledWith('merchant-42', {
        business_name: 'Kicks Hub',
      });
      expect(window.location.href).toBe('/dashboard');
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });
});
