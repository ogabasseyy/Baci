import type { KeyboardTypeOptions } from 'react-native';
import { countryFlag } from '@/components/ui/country-flag';
import { BUSINESS_TYPES } from '@/constants/business-types';
import { COUNTRIES } from '@/constants/countries';
import {
  type OnboardingChatStep,
  type QuickReplyOption,
  TOP_COUNTRY_CODES,
} from './onboarding-chat.types';

export interface StepInputConfig {
  placeholder: string;
  keyboardType: KeyboardTypeOptions;
  autoCapitalize: 'none' | 'sentences' | 'words';
  accessibilityLabel: string;
}

export function getStepInputConfig(
  step: OnboardingChatStep,
  isCustomizingSlug: boolean
): StepInputConfig {
  switch (step) {
    case 'owner_name':
      return {
        placeholder: 'e.g. Ada Okafor',
        keyboardType: 'default',
        autoCapitalize: 'words',
        accessibilityLabel: 'Full name input',
      };
    case 'country':
      return {
        placeholder: 'Type your country or tap above...',
        keyboardType: 'default',
        autoCapitalize: 'words',
        accessibilityLabel: 'Country input',
      };
    case 'phone':
      return {
        placeholder: 'e.g. +234 801 234 5678',
        keyboardType: 'phone-pad',
        autoCapitalize: 'none',
        accessibilityLabel: 'Phone number input',
      };
    case 'business_type':
      return {
        placeholder: 'Type what you sell or pick above...',
        keyboardType: 'default',
        autoCapitalize: 'sentences',
        accessibilityLabel: 'Business category input',
      };
    case 'other_business_type':
      return {
        placeholder: 'e.g. Pet Supplies, Digital Art...',
        keyboardType: 'default',
        autoCapitalize: 'sentences',
        accessibilityLabel: 'Custom business category input',
      };
    case 'business_name':
      return {
        placeholder: 'Type your store name...',
        keyboardType: 'default',
        autoCapitalize: 'words',
        accessibilityLabel: 'Store name input',
      };
    case 'ai_name_description':
      return {
        placeholder: 'e.g. Handmade leather bags in Lagos...',
        keyboardType: 'default',
        autoCapitalize: 'sentences',
        accessibilityLabel: 'Business description for name ideas',
      };
    case 'logo':
      return {
        placeholder: 'Reply or tap an option above...',
        keyboardType: 'default',
        autoCapitalize: 'sentences',
        accessibilityLabel: 'Logo reply input',
      };
    case 'logo_generate_offer':
      return {
        placeholder: 'Type yes to generate, or skip...',
        keyboardType: 'default',
        autoCapitalize: 'sentences',
        accessibilityLabel: 'Logo generation reply input',
      };
    case 'slug':
      return {
        placeholder: isCustomizingSlug
          ? 'my-store-name'
          : 'Type a custom link or tap Looks good...',
        keyboardType: 'default',
        autoCapitalize: 'none',
        accessibilityLabel: 'Custom store link input',
      };
    case 'summary':
      return {
        placeholder: 'Type launch or tap Launch my store...',
        keyboardType: 'default',
        autoCapitalize: 'sentences',
        accessibilityLabel: 'Summary reply input',
      };
  }
}

export function getQuickRepliesForStep(params: {
  step: OnboardingChatStep;
  suggestedNames: string[];
  logoPreviewSource: 'uploaded' | 'generated' | null;
  isCustomizingSlug: boolean;
  hasRejectedSlug?: boolean;
  isProvisioning: boolean;
}): QuickReplyOption[] {
  const {
    step,
    suggestedNames,
    logoPreviewSource,
    isCustomizingSlug,
    hasRejectedSlug = false,
    isProvisioning,
  } = params;

  switch (step) {
    case 'country': {
      const topCountries = TOP_COUNTRY_CODES.map((code) => {
        const match = COUNTRIES.find((country) => country.code === code);
        const name = match?.name ?? code;
        const flag = countryFlag(match ?? { code });
        return {
          id: `country:${code}`,
          label: flag ? `${flag} ${name}` : name,
        };
      });
      return [
        ...topCountries,
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
      return BUSINESS_TYPES.map((type) => ({
        id: `type:${type.id}`,
        label: type.label,
      }));
    case 'business_name': {
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
    }
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
          label: isProvisioning ? 'Launching store...' : 'Launch my store',
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
