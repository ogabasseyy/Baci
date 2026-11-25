import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { useMerchantProvisioning } from '@/hooks/useMerchantProvisioning';
import {
  type OnboardingBrandColors,
  useOnboardingAssist,
} from '@/hooks/useOnboardingAssist';
import { getMerchantProvisioningError } from '@/lib/merchant-provisioning-error';
import {
  runAiLogoGeneration,
  runAiNameSuggestion,
} from './onboarding-chat.ai-actions';
import {
  type PickedLogoAsset,
  persistProvisionedStoreLogo,
  pickOnboardingLogo,
} from './onboarding-chat.logo-upload';
import { transitionFromTextInput } from './onboarding-chat.text-transitions';
import {
  type TransitionResult,
  transitionFromCountry,
  transitionFromQuickReply,
} from './onboarding-chat.transitions';
import {
  createInitialConversation,
  DEFAULT_BRAND_COLORS,
  type OnboardingChatData,
  type OnboardingChatMessage,
  type OnboardingChatStep,
  type QuickReplyOption,
} from './onboarding-chat.types';

interface LogoDraft {
  uri: string;
  colors: OnboardingBrandColors;
  source: 'uploaded' | 'generated';
  pickedAsset: PickedLogoAsset | null;
}

export function useMerchantSetupChat() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const provisionMerchant = useMerchantProvisioning();
  const onboardingAssist = useOnboardingAssist();

  const initial = createInitialConversation(user);
  const [data, setData] = useState<OnboardingChatData>(initial.data);
  const [step, setStep] = useState<OnboardingChatStep>(initial.step);
  const [messages, setMessages] = useState<OnboardingChatMessage[]>(
    initial.messages
  );
  const [inputText, setInputText] = useState('');
  const [suggestedNames, setSuggestedNames] = useState<string[]>([]);
  const [logoDraft, setLogoDraft] = useState<LogoDraft | null>(null);
  const [isCountryModalOpen, setIsCountryModalOpen] = useState(false);
  const [isCustomizingSlug, setIsCustomizingSlug] = useState(false);
  const [rejectedSlug, setRejectedSlug] = useState<string | null>(null);

  const messageCounterRef = useRef(1);
  const hydratedUserId = useRef<string | null>(user?.id ?? null);

  const appendMessages = (...items: Omit<OnboardingChatMessage, 'id'>[]) => {
    setMessages((previous) => [
      ...previous,
      ...items.map((item) => {
        messageCounterRef.current += 1;
        return { ...item, id: `${item.role}-${messageCounterRef.current}` };
      }),
    ]);
  };

  useEffect(() => {
    if (!user) {
      hydratedUserId.current = null;
      return;
    }
    if (hydratedUserId.current !== user.id) {
      hydratedUserId.current = user.id;
      const reset = createInitialConversation(user);
      setData(reset.data);
      setStep(reset.step);
      setMessages(reset.messages);
      setInputText('');
      setSuggestedNames([]);
      setLogoDraft(null);
      setIsCustomizingSlug(false);
    }
  }, [user]);

  const isBusy = onboardingAssist.isPending || provisionMerchant.isPending;

  const handleGenerateNames = async (description: string) => {
    appendMessages({ role: 'user', text: description });
    const outcome = await runAiNameSuggestion(
      onboardingAssist.mutateAsync,
      data,
      description
    );
    if (outcome.names.length > 0) setSuggestedNames(outcome.names);
    appendMessages(outcome.message);
    setStep('business_name');
  };

  const handlePickLogo = async () => {
    const picked = await pickOnboardingLogo();
    if (!picked) return;
    setLogoDraft({
      uri: picked.uri,
      colors: DEFAULT_BRAND_COLORS,
      source: 'uploaded',
      pickedAsset: picked,
    });
    appendMessages(
      { role: 'user', text: 'Uploaded a logo' },
      {
        role: 'assistant',
        text: `Looks great! Would you like to use this logo for ${data.businessName}?`,
        logoPreviewUri: picked.uri,
      }
    );
  };

  const handleGenerateLogo = async () => {
    appendMessages({ role: 'user', text: 'Generate a logo' });
    const outcome = await runAiLogoGeneration(
      onboardingAssist.mutateAsync,
      data
    );
    if (outcome.logoUri) {
      setLogoDraft({
        uri: outcome.logoUri,
        colors: outcome.colors,
        source: 'generated',
        pickedAsset: null,
      });
    }
    appendMessages(outcome.message);
  };

  const promptReauthenticate = (message: string) => {
    Alert.alert('Sign In Again', message, [
      {
        text: 'Sign In Again',
        onPress: () => {
          void signOut().then(() => router.replace('/(auth)/login'));
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleLaunchStore = async () => {
    if (!user?.email) {
      promptReauthenticate(
        'Your authenticated account is missing required identity data. Please sign in again.'
      );
      return;
    }

    try {
      const provisioned = await provisionMerchant.mutateAsync({
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        phone: data.phone.trim() || undefined,
        businessName: data.businessName.trim(),
        businessType: data.businessType,
        otherBusinessType: data.otherBusinessType.trim() || undefined,
        country: data.country,
        slug: data.slug || undefined,
        slugIsCustom: data.slugIsCustom,
        logoUrl: /^https?:\/\//i.test(data.logoUrl) ? data.logoUrl : undefined,
        brandColors: data.brandColors,
      });
      if (provisioned?.merchant?.id) {
        const logoPersisted = await persistProvisionedStoreLogo({
          merchantId: provisioned.merchant.id,
          logoUrl: data.logoUrl,
          pickedAsset: logoDraft?.pickedAsset ?? null,
          businessName: data.businessName.trim(),
          businessType: data.businessType,
        });
        if (!logoPersisted) {
          Alert.alert(
            'Store Created',
            'Your store is ready, but we could not save your logo right now. You can add it anytime in Store Settings.'
          );
        }
      }
      router.replace('/(admin)/(tabs)');
    } catch (error) {
      const provisioningError = getMerchantProvisioningError(error);
      if (provisioningError.code === 'slug_unavailable') {
        setRejectedSlug(data.slug);
        setIsCustomizingSlug(true);
        setStep('slug');
        appendMessages({
          role: 'system',
          text: `${provisioningError.message} Type another store link below:`,
        });
        return;
      }
      if (provisioningError.code === 'identity_incomplete') {
        promptReauthenticate(provisioningError.message);
        return;
      }
      appendMessages({ role: 'system', text: provisioningError.message });
    }
  };

  const applyTransition = (result: TransitionResult) => {
    if (result.nextData) {
      setData((previous) => ({ ...previous, ...result.nextData }));
    }
    if (result.clearAiArtifacts) {
      setSuggestedNames([]);
      setLogoDraft(null);
    }
    if (result.customizingSlug !== undefined) {
      setIsCustomizingSlug(result.customizingSlug);
    }
    if (result.messages?.length) appendMessages(...result.messages);
    if (result.nextStep) setStep(result.nextStep);
    if (result.sideEffect?.type === 'open_country_modal') {
      setIsCountryModalOpen(true);
    } else if (result.sideEffect?.type === 'generate_names') {
      void handleGenerateNames(result.sideEffect.description);
    } else if (result.sideEffect?.type === 'upload_logo') {
      void handlePickLogo();
    } else if (result.sideEffect?.type === 'generate_logo') {
      void handleGenerateLogo();
    } else if (result.sideEffect?.type === 'launch_store') {
      void handleLaunchStore();
    } else if (result.sideEffect?.type === 'restart') {
      const reset = createInitialConversation(user);
      setData(reset.data);
      setStep(reset.step);
      setMessages(reset.messages);
      setInputText('');
      setSuggestedNames([]);
      setLogoDraft(null);
      setIsCustomizingSlug(false);
    }
  };

  return {
    data,
    handleQuickReply: (option: QuickReplyOption) => {
      if (isBusy) return;
      applyTransition(
        transitionFromQuickReply({
          option,
          data,
          previewLogoUri: logoDraft?.uri ?? null,
          previewColors: logoDraft?.colors ?? null,
        })
      );
    },
    handleSelectCountry: (code: string, name?: string) => {
      setIsCountryModalOpen(false);
      applyTransition(transitionFromCountry(code, name));
    },
    handleSendText: () => {
      if (!inputText.trim() || isBusy) return;
      const text = inputText;
      setInputText('');
      applyTransition(
        transitionFromTextInput(step, text, data, isCustomizingSlug)
      );
    },
    hasRejectedSlug: Boolean(rejectedSlug && rejectedSlug === data.slug),
    inputText,
    isBusy,
    isCountryModalOpen,
    isCustomizingSlug,
    isProvisioning: provisionMerchant.isPending,
    logoPreviewSource: logoDraft?.source ?? null,
    messages,
    setInputText,
    setIsCountryModalOpen,
    step,
    suggestedNames,
    user,
  };
}
