import { describe, expect, it } from 'vitest';
import { transitionFromTextInput } from './onboarding-chat.text-transitions';
import { transitionFromQuickReply } from './onboarding-chat.transitions';
import {
  DEFAULT_BRAND_COLORS,
  type OnboardingChatData,
} from './onboarding-chat.types';

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

describe('transitionFromTextInput slug handling', () => {
  it('treats negative replies at the slug confirm prompt as a request to customize rather than setting the slug', () => {
    const result = transitionFromTextInput(
      'slug',
      "No, I don't like it",
      BASE_DATA,
      false
    );

    expect(result.customizingSlug).toBe(true);
    expect(result.nextData).toBeUndefined();
    expect(result.nextStep).toBeUndefined();
    expect(result.messages?.[1]?.text).toContain('Type the store link handle');
  });

  it('applies a custom slug once isCustomizingSlug is true', () => {
    const result = transitionFromTextInput(
      'slug',
      'lagos-kicks',
      BASE_DATA,
      true
    );

    expect(result.nextData).toEqual({
      slug: 'lagos-kicks',
      slugIsCustom: true,
    });
    expect(result.nextStep).toBe('summary');
    expect(result.customizingSlug).toBe(false);
  });

  it('does not open the image picker on ambiguous text at the logo step', () => {
    const result = transitionFromTextInput('logo', 'maybe later', BASE_DATA);

    expect(result.sideEffect).toBeUndefined();
    expect(result.messages?.[1]?.text).toContain('Upload logo');
  });

  it('opens the image picker on explicit upload intent at the logo step', () => {
    const result = transitionFromTextInput('logo', 'upload photo', BASE_DATA);

    expect(result.sideEffect).toEqual({ type: 'upload_logo' });
  });

  it('rejects invalid phone numbers at the phone step', () => {
    const result = transitionFromTextInput('phone', 'not-a-phone', BASE_DATA);

    expect(result.nextStep).toBeUndefined();
    expect(result.nextData).toBeUndefined();
    expect(result.messages?.[1]?.text).toContain('valid phone number');
  });

  it('accepts valid phone numbers and advances to business_type', () => {
    const result = transitionFromTextInput(
      'phone',
      '+234 801 234 5678',
      BASE_DATA
    );

    expect(result.nextStep).toBe('business_type');
    expect(result.nextData).toEqual({ phone: '+234 801 234 5678' });
  });

  it('allows editing store name and phone from the summary step and returning straight to summary', () => {
    const editName = transitionFromQuickReply({
      option: { id: 'summary:edit_name', label: 'Change store name' },
      data: BASE_DATA,
      previewLogoUri: null,
      previewColors: null,
    });
    expect(editName.nextStep).toBe('business_name');
    expect(editName.returnToSummary).toBe(true);

    const customSlugData: OnboardingChatData = {
      ...BASE_DATA,
      slug: 'my-custom-handle',
      slugIsCustom: true,
    };
    const renamed = transitionFromTextInput(
      'business_name',
      'New Store Name',
      customSlugData,
      false,
      true
    );
    expect(renamed.nextStep).toBe('summary');
    expect(renamed.returnToSummary).toBe(false);
    expect(renamed.nextData).toEqual({ businessName: 'New Store Name' });

    const editPhone = transitionFromQuickReply({
      option: { id: 'summary:edit_phone', label: 'Change phone' },
      data: customSlugData,
      previewLogoUri: null,
      previewColors: null,
    });
    expect(editPhone.nextStep).toBe('phone');
    expect(editPhone.returnToSummary).toBe(true);

    const updatedPhone = transitionFromTextInput(
      'phone',
      '+234 801 234 5678',
      customSlugData,
      false,
      true
    );
    expect(updatedPhone.nextStep).toBe('summary');
    expect(updatedPhone.returnToSummary).toBe(false);
    expect(updatedPhone.nextData).toEqual({ phone: '+234 801 234 5678' });
  });

  it('clears previously accepted logoUrl and brandColors when skipping logo setup', () => {
    const withLogo: OnboardingChatData = {
      ...BASE_DATA,
      logoUrl: 'data:image/png;base64,abc123',
      brandColors: {
        primary: '#1E293B',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
    };

    const skipped = transitionFromQuickReply({
      option: { id: 'logo:skip', label: 'Skip for now' },
      data: withLogo,
      previewLogoUri: 'data:image/png;base64,abc123',
      previewColors: withLogo.brandColors,
    });

    expect(skipped.nextData).toEqual({
      logoUrl: '',
      brandColors: DEFAULT_BRAND_COLORS,
    });
    expect(skipped.clearAiArtifacts).toBe(true);
    expect(skipped.nextStep).toBe('slug');
  });

  it('does not falsely match single-letter business categories and routes typed "other" to other_business_type', () => {
    const shortInput = transitionFromTextInput('business_type', 'a', BASE_DATA);
    expect(shortInput.nextData).toEqual({
      businessType: 'other',
      otherBusinessType: 'a',
    });
    expect(shortInput.nextStep).toBe('business_name');

    const typedOther = transitionFromTextInput(
      'business_type',
      'other',
      BASE_DATA
    );
    expect(typedOther.nextData).toEqual({
      businessType: 'other',
      otherBusinessType: '',
    });
    expect(typedOther.nextStep).toBe('other_business_type');

    const typedFashion = transitionFromTextInput(
      'business_type',
      'fashion',
      BASE_DATA
    );
    expect(typedFashion.nextData).toEqual({
      businessType: 'fashion',
      otherBusinessType: '',
    });
    expect(typedFashion.nextStep).toBe('business_name');
  });

  it('applies a directly typed store handle at the slug confirm prompt without discarding it', () => {
    const result = transitionFromTextInput(
      'slug',
      'lagos-kicks',
      BASE_DATA,
      false
    );

    expect(result.nextData).toEqual({
      slug: 'lagos-kicks',
      slugIsCustom: true,
    });
    expect(result.nextStep).toBe('summary');
    expect(result.customizingSlug).toBe(false);
  });

  it('returns a helpful guidance message for unrecognized free text on the summary step', () => {
    const result = transitionFromTextInput(
      'summary',
      'wait a second',
      BASE_DATA
    );

    expect(result.sideEffect).toBeUndefined();
    expect(result.messages?.[1]?.text).toContain('Launch my store');
  });
});
