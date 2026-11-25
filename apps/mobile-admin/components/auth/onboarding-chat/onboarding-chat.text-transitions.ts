import { BUSINESS_TYPES } from '@/constants/business-types';
import { COUNTRIES } from '@/constants/countries';
import {
  exchangeMessages,
  summaryRecapMessages,
  type TransitionResult,
  transitionFromBusinessName,
  transitionFromCountry,
} from './onboarding-chat.transitions';
import {
  DEFAULT_BRAND_COLORS,
  type OnboardingChatData,
  type OnboardingChatStep,
  parseFullNameInput,
  sanitizeSlugInput,
} from './onboarding-chat.types';

export function transitionFromTextInput(
  step: OnboardingChatStep,
  rawText: string,
  data: OnboardingChatData,
  isCustomizingSlug = false,
  returnToSummary = false
): TransitionResult {
  const trimmed = rawText.trim();
  if (!trimmed) return {};
  const lower = trimmed.toLowerCase();

  if (step === 'owner_name') {
    const parsed = parseFullNameInput(trimmed);
    if (!parsed) {
      return {
        messages: exchangeMessages(
          trimmed,
          'Please include both your first and last name (for example, "Ada Okafor").'
        ),
      };
    }
    return {
      nextData: parsed,
      nextStep: 'country',
      messages: exchangeMessages(
        trimmed,
        `Nice to meet you, ${parsed.firstName}! Where is your business based?`
      ),
    };
  }

  if (step === 'country') {
    const matched = COUNTRIES.find(
      (c) => c.name.toLowerCase() === lower || c.code.toLowerCase() === lower
    );
    if (matched) return transitionFromCountry(matched.code, matched.name);
    return {
      messages: exchangeMessages(
        trimmed,
        'Tap one of the countries below or choose "More countries..." to search.'
      ),
    };
  }

  if (step === 'phone') {
    if (lower === 'skip' || lower === 'skip for now') {
      if (returnToSummary) {
        return {
          nextData: { phone: '' },
          nextStep: 'summary',
          returnToSummary: false,
          messages: summaryRecapMessages(trimmed),
        };
      }
      return {
        nextStep: 'business_type',
        messages: exchangeMessages(
          trimmed,
          'No problem! What kind of products do you sell?'
        ),
      };
    }
    const digitsOnly = trimmed.replace(/\D/g, '');
    if (
      !/^[+\d\s()-]+$/.test(trimmed) ||
      digitsOnly.length < 7 ||
      digitsOnly.length > 15
    ) {
      return {
        messages: exchangeMessages(
          trimmed,
          'Please enter a valid phone number (7–15 digits) or tap "Skip for now".'
        ),
      };
    }
    if (returnToSummary) {
      return {
        nextData: { phone: trimmed },
        nextStep: 'summary',
        returnToSummary: false,
        messages: summaryRecapMessages(trimmed),
      };
    }
    return {
      nextData: { phone: trimmed },
      nextStep: 'business_type',
      messages: exchangeMessages(
        trimmed,
        'Got it! What kind of products do you sell?'
      ),
    };
  }

  if (step === 'business_type') {
    const matched = BUSINESS_TYPES.find(
      (item) => item.label.toLowerCase().includes(lower) || item.id === lower
    );
    if (matched && matched.id !== 'other') {
      return {
        nextData: { businessType: matched.id, otherBusinessType: '' },
        nextStep: 'business_name',
        messages: exchangeMessages(
          matched.label,
          'Great choice! What would you like to name your store?'
        ),
      };
    }
    return {
      nextData: { businessType: 'other', otherBusinessType: trimmed },
      nextStep: 'business_name',
      messages: exchangeMessages(
        trimmed,
        'Awesome! What would you like to name your store?'
      ),
    };
  }

  if (step === 'other_business_type') {
    return {
      nextData: { otherBusinessType: trimmed },
      nextStep: 'business_name',
      messages: exchangeMessages(
        trimmed,
        'Awesome! What would you like to name your store?'
      ),
    };
  }

  if (step === 'business_name') {
    return transitionFromBusinessName(trimmed, { data, returnToSummary });
  }

  if (step === 'ai_name_description') {
    return { sideEffect: { type: 'generate_names', description: trimmed } };
  }

  if (step === 'logo') {
    if (lower.includes('skip')) {
      return {
        nextData: { logoUrl: '', brandColors: DEFAULT_BRAND_COLORS },
        nextStep: 'slug',
        customizingSlug: false,
        clearAiArtifacts: true,
        messages: exchangeMessages(
          trimmed,
          `Your store link will be ${data.slug}.usebaci.com. Does that look good?`
        ),
      };
    }
    if (
      lower.includes('no') ||
      lower.includes("don't") ||
      lower.includes('dont')
    ) {
      return {
        nextStep: 'logo_generate_offer',
        messages: exchangeMessages(
          trimmed,
          `No problem! Want me to generate a starter logo for ${data.businessName}?`
        ),
      };
    }
    if (
      lower.includes('upload') ||
      lower.includes('choose') ||
      lower.includes('pick') ||
      lower.includes('photo')
    ) {
      return { sideEffect: { type: 'upload_logo' } };
    }
    return {
      messages: exchangeMessages(
        trimmed,
        'Tap "Upload logo" to pick an image, "I don\'t have one" to generate a starter logo, or "Skip for now".'
      ),
    };
  }

  if (step === 'logo_generate_offer') {
    if (lower.includes('yes') || lower.includes('generate')) {
      return { sideEffect: { type: 'generate_logo' } };
    }
    return {
      nextData: { logoUrl: '', brandColors: DEFAULT_BRAND_COLORS },
      nextStep: 'slug',
      customizingSlug: false,
      clearAiArtifacts: true,
      messages: exchangeMessages(
        trimmed,
        `Your store link will be ${data.slug}.usebaci.com. Does that look good?`
      ),
    };
  }

  if (step === 'slug') {
    if (
      !isCustomizingSlug &&
      (lower === 'yes' ||
        lower === 'looks good' ||
        lower === 'ok' ||
        lower === 'confirm')
    ) {
      return {
        nextStep: 'summary',
        customizingSlug: false,
        messages: exchangeMessages(
          `Use ${data.slug}.usebaci.com`,
          "Everything's ready! Here's a quick recap of your store:",
          { isSummary: true }
        ),
      };
    }
    if (!isCustomizingSlug) {
      return {
        customizingSlug: true,
        messages: exchangeMessages(
          trimmed,
          'No problem! Type the store link handle you want (letters, numbers, and hyphens):'
        ),
      };
    }
    const cleaned = sanitizeSlugInput(trimmed);
    if (!cleaned) {
      return {
        messages: exchangeMessages(
          trimmed,
          'Use letters, numbers, or hyphens for your store link (for example, "kicks-hub").'
        ),
      };
    }
    return {
      nextData: { slug: cleaned, slugIsCustom: true },
      nextStep: 'summary',
      customizingSlug: false,
      messages: exchangeMessages(
        `${cleaned}.usebaci.com`,
        "Everything's ready! Here's a quick recap of your store:",
        { isSummary: true }
      ),
    };
  }

  if (step === 'summary' && (lower.includes('launch') || lower === 'yes')) {
    return { sideEffect: { type: 'launch_store' } };
  }

  return {};
}
