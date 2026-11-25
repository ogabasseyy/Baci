import {
  DEFAULT_BRAND_COLORS,
  getCountryName,
  type OnboardingChatData,
  type OnboardingChatMessage,
  type OnboardingChatStep,
  type QuickReplyOption,
  slugifyBusinessName,
} from './onboarding-chat.types';

export type PendingMessage = Omit<OnboardingChatMessage, 'id'>;

export interface TransitionResult {
  nextData?: Partial<OnboardingChatData>;
  nextStep?: OnboardingChatStep;
  messages?: PendingMessage[];
  customizingSlug?: boolean;
  returnToSummary?: boolean;
  clearAiArtifacts?: boolean;
  sideEffect?:
    | { type: 'generate_names'; description: string }
    | { type: 'upload_logo' }
    | { type: 'generate_logo' }
    | { type: 'open_country_modal' }
    | { type: 'launch_store' }
    | { type: 'restart' };
}

export function exchangeMessages(
  userText: string,
  assistantText: string,
  extra?: Partial<PendingMessage>
): PendingMessage[] {
  return [
    { role: 'user', text: userText },
    { role: 'assistant', text: assistantText, ...extra },
  ];
}

export function summaryRecapMessages(userText: string): PendingMessage[] {
  return exchangeMessages(
    userText,
    "Everything's ready! Here's a quick recap of your store:",
    { isSummary: true }
  );
}

export function transitionFromBusinessName(
  name: string,
  options?: { data?: OnboardingChatData; returnToSummary?: boolean }
): TransitionResult {
  const trimmed = name.trim();
  if (!trimmed) return {};
  const generatedSlug = slugifyBusinessName(trimmed) || 'my-store';
  if (options?.returnToSummary) {
    const keepCustomSlug = Boolean(
      options.data?.slugIsCustom && options.data?.slug
    );
    return {
      nextData: {
        businessName: trimmed,
        ...(keepCustomSlug ? {} : { slug: generatedSlug, slugIsCustom: false }),
      },
      nextStep: 'summary',
      returnToSummary: false,
      messages: summaryRecapMessages(trimmed),
    };
  }
  return {
    nextData: {
      businessName: trimmed,
      slug: generatedSlug,
      slugIsCustom: false,
      logoUrl: '',
      brandColors: DEFAULT_BRAND_COLORS,
    },
    nextStep: 'logo',
    clearAiArtifacts: true,
    messages: exchangeMessages(
      trimmed,
      `Love "${trimmed}"! Do you have a logo for your store? You can upload one now.`
    ),
  };
}

export function transitionFromCountry(
  code: string,
  name?: string
): TransitionResult {
  return {
    nextData: { country: code },
    nextStep: 'phone',
    messages: exchangeMessages(
      name ?? getCountryName(code),
      "What's the best phone number for store updates and order alerts? (Optional)"
    ),
  };
}

export function transitionFromQuickReply(params: {
  option: QuickReplyOption;
  data: OnboardingChatData;
  previewLogoUri: string | null;
  previewColors: OnboardingChatData['brandColors'] | null;
  returnToSummary?: boolean;
}): TransitionResult {
  const { option, data, previewLogoUri, previewColors, returnToSummary } =
    params;
  const { id, label } = option;

  if (id === 'country:more')
    return { sideEffect: { type: 'open_country_modal' } };
  if (id.startsWith('country:'))
    return transitionFromCountry(id.replace('country:', ''));
  if (id === 'phone:skip') {
    if (returnToSummary) {
      return {
        nextData: { phone: '' },
        nextStep: 'summary',
        returnToSummary: false,
        messages: summaryRecapMessages('Skip for now'),
      };
    }
    return {
      nextStep: 'business_type',
      messages: exchangeMessages(
        'Skip for now',
        'No problem! What kind of products do you sell?'
      ),
    };
  }
  if (id.startsWith('type:')) {
    const typeId = id.replace('type:', '');
    const isOther = typeId === 'other';
    return {
      nextData: {
        businessType: typeId,
        otherBusinessType: isOther ? data.otherBusinessType : '',
      },
      nextStep: isOther ? 'other_business_type' : 'business_name',
      messages: exchangeMessages(
        label,
        isOther
          ? 'Tell me what kind of products or services you sell:'
          : 'Great choice! What would you like to name your store?'
      ),
    };
  }
  if (id === 'name:ai_suggest') {
    return {
      nextStep: 'ai_name_description',
      messages: exchangeMessages(
        label,
        "Tell me in one sentence what you sell or the vibe you're going for, and I'll brainstorm 6 names for you!"
      ),
    };
  }
  if (id === 'name:back_manual') {
    return {
      nextStep: 'business_name',
      messages: exchangeMessages(
        label,
        'Sure thing — type your store name below!'
      ),
    };
  }
  if (id.startsWith('name:')) {
    return transitionFromBusinessName(id.replace('name:', ''), {
      data,
      returnToSummary,
    });
  }
  if (id === 'logo:upload') return { sideEffect: { type: 'upload_logo' } };
  if (id === 'logo:no_logo') {
    return {
      nextStep: 'logo_generate_offer',
      messages: exchangeMessages(
        "I don't have one",
        `No problem! Want me to generate a starter logo for ${data.businessName}?`
      ),
    };
  }
  if (id === 'logo:generate') return { sideEffect: { type: 'generate_logo' } };
  if (id === 'logo:accept' && previewLogoUri) {
    return {
      nextData: {
        logoUrl: previewLogoUri,
        brandColors: previewColors ?? DEFAULT_BRAND_COLORS,
      },
      nextStep: 'slug',
      customizingSlug: false,
      messages: exchangeMessages(
        'Use this logo',
        `Your store link will be ${data.slug}.usebaci.com. Does that look good?`
      ),
    };
  }
  if (id === 'logo:skip') {
    return {
      nextData: {
        logoUrl: '',
        brandColors: DEFAULT_BRAND_COLORS,
      },
      nextStep: 'slug',
      customizingSlug: false,
      clearAiArtifacts: true,
      messages: exchangeMessages(
        'Skip for now',
        `Your store link will be ${data.slug}.usebaci.com. Does that look good?`
      ),
    };
  }
  if (id === 'slug:confirm') {
    return {
      nextStep: 'summary',
      customizingSlug: false,
      messages: summaryRecapMessages(`Use ${data.slug}.usebaci.com`),
    };
  }
  if (id === 'slug:customize') {
    return {
      customizingSlug: true,
      messages: exchangeMessages(
        'Customize link',
        'Type the store link handle you want (letters, numbers, and hyphens):'
      ),
    };
  }
  if (id === 'summary:launch') return { sideEffect: { type: 'launch_store' } };
  if (id === 'summary:edit_slug') {
    return {
      nextStep: 'slug',
      customizingSlug: true,
      messages: exchangeMessages(
        'Change link',
        'What would you like your store link handle to be?'
      ),
    };
  }
  if (id === 'summary:edit_name') {
    return {
      nextStep: 'business_name',
      returnToSummary: true,
      messages: exchangeMessages(
        'Change store name',
        'Sure! What would you like to name your store?'
      ),
    };
  }
  if (id === 'summary:edit_phone') {
    return {
      nextStep: 'phone',
      returnToSummary: true,
      messages: exchangeMessages(
        'Change phone',
        'Enter your updated phone number or tap "Skip for now":'
      ),
    };
  }
  if (id === 'summary:restart') return { sideEffect: { type: 'restart' } };
  return {};
}
