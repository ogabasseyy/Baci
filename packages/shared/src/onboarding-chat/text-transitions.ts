import {
  transitionFromSlugText,
  transitionFromSummaryText,
} from './slug-summary-text-transitions';
import {
  exchangeMessages,
  summaryRecapMessages,
  type TransitionResult,
  transitionFromBusinessName,
  transitionFromCountry,
} from './transitions';
import {
  DEFAULT_BRAND_COLORS,
  isValidOnboardingPhone,
  type OnboardingBusinessTypeOption,
  type OnboardingChatData,
  type OnboardingChatStep,
  type OnboardingCountryOption,
  parseFullNameInput,
} from './types';

function skipLogoTextTransition(
  userText: string,
  slug: string
): TransitionResult {
  return {
    nextData: { logoUrl: '', brandColors: DEFAULT_BRAND_COLORS },
    nextStep: 'slug',
    customizingSlug: false,
    clearAiArtifacts: true,
    messages: exchangeMessages(
      userText,
      `Your store link will be ${slug}.usebaci.com. Does that look good?`
    ),
  };
}

export interface TextTransitionParams {
  step: OnboardingChatStep;
  rawText: string;
  data: OnboardingChatData;
  countries: readonly OnboardingCountryOption[];
  businessTypes: readonly OnboardingBusinessTypeOption[];
  isCustomizingSlug?: boolean;
  returnToSummary?: boolean;
}

export function transitionFromTextInput(
  params: TextTransitionParams
): TransitionResult {
  const {
    step,
    rawText,
    data,
    countries,
    businessTypes,
    isCustomizingSlug = false,
    returnToSummary = false,
  } = params;
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
    const matched = countries.find(
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
    if (!isValidOnboardingPhone(trimmed)) {
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
    if (lower === 'other') {
      return {
        nextData: { businessType: 'other', otherBusinessType: '' },
        nextStep: 'other_business_type',
        messages: exchangeMessages(
          trimmed,
          'Tell me what kind of products or services you sell:'
        ),
      };
    }
    const matched =
      lower.length >= 3
        ? businessTypes.find((item) => {
            if (item.id === 'other') return false;
            const labelLower = item.label.toLowerCase();
            if (item.id === lower || labelLower === lower) return true;
            if (labelLower.startsWith(lower)) return true;
            const words = labelLower.split(/[^a-z0-9]+/).filter(Boolean);
            return words.some(
              (word) =>
                word === lower || (lower.length >= 4 && word.startsWith(lower))
            );
          })
        : undefined;
    if (matched) {
      return {
        nextData: { businessType: matched.id, otherBusinessType: '' },
        nextStep: 'business_name',
        messages: exchangeMessages(
          matched.label,
          'Great choice! What would you like to name your store?'
        ),
      };
    }
    if (trimmed.length < 2) {
      return {
        messages: exchangeMessages(
          trimmed,
          'Please describe your business type with at least 2 characters, or pick a category above.'
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
    if (trimmed.length < 2) {
      return {
        messages: exchangeMessages(
          trimmed,
          'Please describe your business type with at least 2 characters.'
        ),
      };
    }
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
    if (/\bskip\b/.test(lower)) {
      return skipLogoTextTransition(trimmed, data.slug);
    }
    if (/\b(upload|choose|pick|photo)\b/.test(lower)) {
      return { sideEffect: { type: 'upload_logo' } };
    }
    if (/\b(no|nope|nah|don't|dont|none)\b/.test(lower)) {
      return {
        nextStep: 'logo_generate_offer',
        messages: exchangeMessages(
          trimmed,
          `No problem! Want me to generate a starter logo for ${data.businessName}?`
        ),
      };
    }
    return {
      messages: exchangeMessages(
        trimmed,
        'Tap "Upload logo" to pick an image, "I don\'t have one" to generate a starter logo, or "Skip for now".'
      ),
    };
  }

  if (step === 'logo_generate_offer') {
    const isNegated = /\b(don't|dont|no|nope|nah|skip)\b/.test(lower);
    if (!isNegated && (lower.includes('yes') || lower.includes('generate'))) {
      return { sideEffect: { type: 'generate_logo' } };
    }
    return skipLogoTextTransition(trimmed, data.slug);
  }

  if (step === 'slug') {
    return transitionFromSlugText(trimmed, lower, data.slug, isCustomizingSlug);
  }

  if (step === 'summary') {
    return transitionFromSummaryText(trimmed, lower);
  }

  return {};
}
