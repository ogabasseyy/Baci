import {
  type QuickReplyOption,
  TOP_COUNTRY_CODES,
} from '@baci/shared/onboarding-chat';
import {
  WEB_BUSINESS_TYPES,
  WEB_COUNTRIES,
  type WebChatStep,
} from './web-onboarding-chat-helpers';

export interface WebStepInputConfig {
  placeholder: string;
  inputType: 'text' | 'email' | 'password' | 'tel';
  accessibilityLabel: string;
}

export function getWebStepInputConfig(
  step: WebChatStep,
  isCustomizingSlug: boolean
): WebStepInputConfig {
  switch (step) {
    case 'auth_choice':
      return {
        placeholder: 'Type your email or pick an option above...',
        inputType: 'email',
        accessibilityLabel: 'Account option or email input',
      };
    case 'auth_name':
    case 'owner_name':
      return {
        placeholder: 'e.g. Ada Okafor',
        inputType: 'text',
        accessibilityLabel: 'Full name input',
      };
    case 'auth_email':
    case 'auth_magic_email':
      return {
        placeholder: 'you@example.com',
        inputType: 'email',
        accessibilityLabel: 'Email address input',
      };
    case 'auth_password':
      return {
        placeholder: 'Create a strong password (8+ characters)...',
        inputType: 'password',
        accessibilityLabel: 'Password input',
      };
    case 'auth_confirm':
      return {
        placeholder: 'Re-enter your password...',
        inputType: 'password',
        accessibilityLabel: 'Confirm password input',
      };
    case 'auth_check_email':
      return {
        placeholder: 'Check your inbox for the confirmation link...',
        inputType: 'text',
        accessibilityLabel: 'Email confirmation status',
      };
    case 'country':
      return {
        placeholder: 'Type your country or pick above...',
        inputType: 'text',
        accessibilityLabel: 'Country input',
      };
    case 'phone':
      return {
        placeholder: 'e.g. +234 801 234 5678',
        inputType: 'tel',
        accessibilityLabel: 'Phone number input',
      };
    case 'business_type':
      return {
        placeholder: 'Type what you sell or pick above...',
        inputType: 'text',
        accessibilityLabel: 'Business category input',
      };
    case 'other_business_type':
      return {
        placeholder: 'e.g. Pet Supplies, Digital Art...',
        inputType: 'text',
        accessibilityLabel: 'Custom business category input',
      };
    case 'business_name':
      return {
        placeholder: 'Type your store name...',
        inputType: 'text',
        accessibilityLabel: 'Store name input',
      };
    case 'ai_name_description':
      return {
        placeholder: 'e.g. Handmade leather bags in Lagos...',
        inputType: 'text',
        accessibilityLabel: 'Business description for name ideas',
      };
    case 'logo':
      return {
        placeholder: 'Reply or upload a logo above...',
        inputType: 'text',
        accessibilityLabel: 'Logo reply input',
      };
    case 'logo_generate_offer':
      return {
        placeholder: 'Type yes to generate, or skip...',
        inputType: 'text',
        accessibilityLabel: 'Logo generation reply input',
      };
    case 'slug':
      return {
        placeholder: isCustomizingSlug
          ? 'my-store-name'
          : 'Type a custom link or tap Looks good...',
        inputType: 'text',
        accessibilityLabel: 'Custom store link input',
      };
    case 'summary':
      return {
        placeholder: 'Type launch or click Launch my store...',
        inputType: 'text',
        accessibilityLabel: 'Summary reply input',
      };
  }
}

export function getWebQuickRepliesForStep(params: {
  step: WebChatStep;
  suggestedNames: string[];
  logoPreviewSource: 'uploaded' | 'generated' | null;
  isCustomizingSlug: boolean;
  hasRejectedSlug?: boolean;
  isLaunching: boolean;
}): QuickReplyOption[] {
  const {
    step,
    suggestedNames,
    logoPreviewSource,
    isCustomizingSlug,
    hasRejectedSlug = false,
    isLaunching,
  } = params;

  switch (step) {
    case 'auth_choice':
      return [
        { id: 'auth:google', label: 'Continue with Google', variant: 'accent' },
        {
          id: 'auth:email',
          label: 'Create account with email',
          variant: 'secondary',
        },
        { id: 'auth:magic_link', label: 'Sign in with magic link' },
      ];
    case 'auth_confirm':
      return [
        {
          id: 'auth:edit_password',
          label: 'Change password',
          variant: 'secondary',
        },
        { id: 'auth:edit_email', label: 'Change email' },
      ];
    case 'country': {
      const top = TOP_COUNTRY_CODES.map((code) => {
        const match = WEB_COUNTRIES.find((c) => c.code === code);
        return {
          id: `country:${code}`,
          label: match ? `${match.flag} ${match.name}` : code,
        };
      });
      return [
        ...top,
        {
          id: 'country:more',
          label: 'More countries...',
          variant: 'secondary',
        },
      ];
    }
    case 'phone':
      return [
        { id: 'phone:skip', label: 'Skip for now', variant: 'secondary' },
      ];
    case 'business_type':
      return WEB_BUSINESS_TYPES.map((item) => ({
        id: `type:${item.id}`,
        label: item.label,
      }));
    case 'business_name':
      if (suggestedNames.length > 0) {
        return [
          ...suggestedNames.map((name) => ({
            id: `name:${name}`,
            label: name,
            variant: 'secondary' as const,
          })),
          { id: 'name:ai_suggest', label: 'More AI ideas' },
        ];
      }
      return [
        {
          id: 'name:ai_suggest',
          label: 'Suggest names for me',
          variant: 'secondary',
        },
      ];
    case 'ai_name_description':
      return [
        {
          id: 'name:back_manual',
          label: "I'll type my own name",
          variant: 'secondary',
        },
      ];
    case 'logo':
      if (logoPreviewSource === 'uploaded') {
        return [
          { id: 'logo:accept', label: 'Use this logo', variant: 'accent' },
          { id: 'logo:upload', label: 'Choose another', variant: 'secondary' },
          { id: 'logo:skip', label: 'Skip logo' },
        ];
      }
      return [
        { id: 'logo:upload', label: 'Upload logo', variant: 'accent' },
        { id: 'logo:no_logo', label: "I don't have one", variant: 'secondary' },
        { id: 'logo:skip', label: 'Skip for now' },
      ];
    case 'logo_generate_offer':
      if (logoPreviewSource === 'generated') {
        return [
          { id: 'logo:accept', label: 'Use this logo', variant: 'accent' },
          { id: 'logo:generate', label: 'Try another', variant: 'secondary' },
          { id: 'logo:skip', label: 'Skip logo' },
        ];
      }
      return [
        { id: 'logo:generate', label: 'Generate a logo', variant: 'accent' },
        { id: 'logo:skip', label: 'Skip for now', variant: 'secondary' },
      ];
    case 'slug':
      if (isCustomizingSlug) {
        return hasRejectedSlug
          ? []
          : [
              {
                id: 'slug:confirm',
                label: 'Use suggested link',
                variant: 'secondary',
              },
            ];
      }
      return [
        { id: 'slug:confirm', label: 'Looks good!', variant: 'accent' },
        { id: 'slug:customize', label: 'Customize link', variant: 'secondary' },
      ];
    case 'summary':
      return [
        {
          id: 'summary:launch',
          label: isLaunching ? 'Launching store...' : 'Launch my store',
          variant: 'accent',
        },
        { id: 'summary:edit_slug', label: 'Change link', variant: 'secondary' },
        { id: 'summary:edit_name', label: 'Change store name' },
        { id: 'summary:edit_phone', label: 'Change phone' },
        { id: 'summary:restart', label: 'Start over' },
      ];
    default:
      return [];
  }
}
