import { describe, expect, it } from 'vitest';
import { transitionFromTextInput } from './onboarding-chat.text-transitions';
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
});
