import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRAND_COLORS,
  isValidOnboardingPhone,
  isValidStoreSlug,
  normalizePersonName,
  type OnboardingChatData,
  sanitizeSlugInput,
  slugifyBusinessName,
  transitionFromQuickReply,
  transitionFromTextInput,
} from './index';

const COUNTRIES = [
  { code: 'NG', name: 'Nigeria' },
  { code: 'GB', name: 'United Kingdom' },
] as const;

const BUSINESS_TYPES = [
  { id: 'fashion', label: 'Fashion & Apparel' },
  { id: 'other', label: 'Other' },
] as const;

const BASE_DATA: OnboardingChatData = {
  firstName: 'Ada',
  lastName: 'Okafor',
  phone: '',
  businessName: 'SoleLux',
  businessType: 'fashion',
  otherBusinessType: '',
  country: 'NG',
  slug: 'solelux',
  slugIsCustom: false,
  logoUrl: '',
  brandColors: DEFAULT_BRAND_COLORS,
};

describe('@baci/shared/onboarding-chat', () => {
  it('validates and normalizes slugs, names, and phone numbers', () => {
    expect(sanitizeSlugInput('--Kicks--Hub--')).toBe('kicks-hub');
    expect(isValidStoreSlug('kicks-hub')).toBe(true);
    expect(isValidStoreSlug('ab')).toBe(false);
    expect(isValidStoreSlug('a'.repeat(64))).toBe(false);
    expect(isValidStoreSlug('admin')).toBe(false);
    expect(isValidStoreSlug('api')).toBe(false);
    expect(isValidStoreSlug('chat')).toBe(false);
    expect(isValidStoreSlug('onboarding')).toBe(false);
    expect(slugifyBusinessName('AB')).toBe('ab-store');
    expect(slugifyBusinessName('Admin')).toBe('admin-store');
    expect(slugifyBusinessName('Chat')).toBe('chat-store');
    expect(slugifyBusinessName('API')).toBe('api-store');
    expect(slugifyBusinessName('Onboarding')).toBe('onboarding-store');
    expect(normalizePersonName("mary O'Brien McDonald")).toBe(
      "Mary O'Brien McDonald"
    );
    expect(normalizePersonName('ADA OKAFOR')).toBe('Ada Okafor');
    expect(isValidOnboardingPhone('+234 801 234 5678')).toBe(true);
    expect(isValidOnboardingPhone('abc')).toBe(false);
  });

  it('handles logo intent, negation, slug confirmation, and summary edits cleanly', () => {
    const upload = transitionFromTextInput({
      step: 'logo',
      rawText: 'choose another',
      data: BASE_DATA,
      countries: COUNTRIES,
      businessTypes: BUSINESS_TYPES,
    });
    expect(upload.sideEffect).toEqual({ type: 'upload_logo' });

    const negatedOffer = transitionFromTextInput({
      step: 'logo_generate_offer',
      rawText: "Don't generate",
      data: BASE_DATA,
      countries: COUNTRIES,
      businessTypes: BUSINESS_TYPES,
    });
    expect(negatedOffer.nextStep).toBe('slug');
    expect(negatedOffer.nextData).toEqual({
      logoUrl: '',
      brandColors: DEFAULT_BRAND_COLORS,
    });

    const confirm = transitionFromTextInput({
      step: 'slug',
      rawText: 'Looks good!',
      data: BASE_DATA,
      countries: COUNTRIES,
      businessTypes: BUSINESS_TYPES,
    });
    expect(confirm.nextStep).toBe('summary');

    const editPhone = transitionFromQuickReply({
      option: { id: 'summary:edit_phone', label: 'Change phone' },
      data: BASE_DATA,
      previewLogoUri: null,
      previewColors: null,
    });
    expect(editPhone.returnToSummary).toBe(true);
    expect(editPhone.nextStep).toBe('phone');
  });

  it('requires affirmative summary text to launch and ignores negated or question text', () => {
    for (const negative of ["don't launch yet", 'can I launch later?']) {
      const result = transitionFromTextInput({
        step: 'summary',
        rawText: negative,
        data: BASE_DATA,
        countries: COUNTRIES,
        businessTypes: BUSINESS_TYPES,
      });
      expect(result.sideEffect).toBeUndefined();
      expect(result.messages).toHaveLength(2);
    }

    for (const affirmative of ['Launch my store!', 'launch', 'yes']) {
      const result = transitionFromTextInput({
        step: 'summary',
        rawText: affirmative,
        data: BASE_DATA,
        countries: COUNTRIES,
        businessTypes: BUSINESS_TYPES,
      });
      expect(result.sideEffect).toEqual({ type: 'launch_store' });
    }
  });

  it('rejects reserved custom slugs and <2-char store names or custom categories', () => {
    for (const reserved of ['admin', 'api', 'chat', 'onboarding']) {
      for (const isCustomizingSlug of [false, true]) {
        const result = transitionFromTextInput({
          step: 'slug',
          rawText: reserved,
          data: BASE_DATA,
          countries: COUNTRIES,
          businessTypes: BUSINESS_TYPES,
          isCustomizingSlug,
        });
        expect(result.nextStep).toBeUndefined();
        expect(result.nextData).toBeUndefined();
        expect(result.messages?.[1]?.text).toContain('reserved');
      }
    }

    const shortName = transitionFromTextInput({
      step: 'business_name',
      rawText: 'A',
      data: BASE_DATA,
      countries: COUNTRIES,
      businessTypes: BUSINESS_TYPES,
    });
    expect(shortName.nextStep).toBeUndefined();
    expect(shortName.messages?.[1]?.text).toContain('at least 2 characters');

    const shortCategory = transitionFromTextInput({
      step: 'other_business_type',
      rawText: 'X',
      data: BASE_DATA,
      countries: COUNTRIES,
      businessTypes: BUSINESS_TYPES,
    });
    expect(shortCategory.nextStep).toBeUndefined();
    expect(shortCategory.messages?.[1]?.text).toContain(
      'at least 2 characters'
    );
  });
});
