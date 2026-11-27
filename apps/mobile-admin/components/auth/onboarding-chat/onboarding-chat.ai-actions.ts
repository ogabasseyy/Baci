import type {
  OnboardingAssistRequest,
  OnboardingAssistResponse,
  OnboardingBrandColors,
} from '@/hooks/useOnboardingAssist';
import {
  DEFAULT_BRAND_COLORS,
  getBusinessTypeLabel,
  type OnboardingChatData,
  type OnboardingChatMessage,
} from './onboarding-chat.types';

type AssistMutate = (
  payload: OnboardingAssistRequest
) => Promise<OnboardingAssistResponse>;

export async function runAiNameSuggestion(
  mutateAsync: AssistMutate,
  data: OnboardingChatData,
  description: string
): Promise<{
  names: string[];
  message: Omit<OnboardingChatMessage, 'id'>;
}> {
  try {
    const result = await mutateAsync({
      task: 'generate_names',
      businessName: '',
      businessType: getBusinessTypeLabel(
        data.businessType,
        data.otherBusinessType
      ),
      brandPreferences: 'Modern and memorable',
      description,
      tone: 'Modern',
    });
    const names = (result.businessNames ?? [])
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6);
    if (names.length === 0) {
      return {
        names: [],
        message: {
          role: 'assistant',
          text: "I couldn't brainstorm names right now. Type your favorite store name below!",
        },
      };
    }
    return {
      names,
      message: {
        role: 'assistant',
        text: 'Here are some name ideas — tap one you like, or type your own below:',
      },
    };
  } catch {
    return {
      names: [],
      message: {
        role: 'system',
        text: "I couldn't reach the AI naming assistant right now. You can type your store name directly below.",
      },
    };
  }
}

export async function runAiLogoGeneration(
  mutateAsync: AssistMutate,
  data: OnboardingChatData
): Promise<{
  logoUri: string | null;
  colors: OnboardingBrandColors;
  message: Omit<OnboardingChatMessage, 'id'>;
}> {
  try {
    const result = await mutateAsync({
      task: 'generate_logos',
      businessName: data.businessName,
      businessType:
        data.businessType === 'other' && data.otherBusinessType.trim()
          ? data.otherBusinessType.trim()
          : data.businessType,
      brandPreferences: 'Modern minimalist',
    });
    const rawLogoUri = result.logos?.[0] ?? null;
    const logoUri =
      rawLogoUri && /^data:image\/(png|jpeg|webp);base64,/i.test(rawLogoUri)
        ? rawLogoUri
        : null;
    if (!logoUri) {
      return {
        logoUri: null,
        colors: result.brandColors ?? DEFAULT_BRAND_COLORS,
        message: {
          role: 'system',
          text: "I couldn't generate a logo right now. You can try again or skip for now.",
        },
      };
    }
    return {
      logoUri,
      colors: result.brandColors ?? DEFAULT_BRAND_COLORS,
      message: {
        role: 'assistant',
        text: `Here's a starter logo for ${data.businessName}! What do you think?`,
        logoPreviewUri: logoUri,
        brandColors: result.brandColors,
      },
    };
  } catch {
    return {
      logoUri: null,
      colors: DEFAULT_BRAND_COLORS,
      message: {
        role: 'system',
        text: "Logo generation isn't available right now. You can skip and add one later in Store Settings.",
      },
    };
  }
}
