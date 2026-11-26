'use client';

import {
  type OnboardingChatData,
  type OnboardingChatMessage,
  type OnboardingChatStep,
  type QuickReplyOption,
  type TransitionResult,
  transitionFromCountry,
  transitionFromQuickReply,
  transitionFromTextInput,
} from '@baci/shared/onboarding-chat';
import type { User } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  type AuthDraft,
  runWebAuthQuickReply,
  runWebAuthTextInput,
} from './web-onboarding-auth-handlers';
import {
  buildInitialWebStoreData,
  extractUserNames,
  WEB_BUSINESS_TYPES,
  WEB_COUNTRIES,
  type WebChatStep,
} from './web-onboarding-chat-helpers';
import {
  type LogoDraft,
  runWebLogoFileUpload,
  runWebLogoGeneration,
  runWebNameSuggestion,
  runWebStoreLaunch,
} from './web-onboarding-store-actions';

async function hasCompletedMerchant(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<boolean> {
  if (typeof supabase.from !== 'function') return false;
  try {
    const { data: existingMerchant } = await supabase
      .from('merchants')
      .select('business_name')
      .eq('user_id', userId)
      .maybeSingle();
    return Boolean(existingMerchant?.business_name);
  } catch {
    return false;
  }
}

export function useWebOnboardingChat() {
  const [user, setUser] = useState<User | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);
  const [step, setStep] = useState<WebChatStep>('auth_choice');
  const [data, setData] = useState<OnboardingChatData>(() =>
    buildInitialWebStoreData(null)
  );
  const [messages, setMessages] = useState<OnboardingChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: "Hi! I'm Baci. Let's get your online store live in a couple of minutes. First, how would you like to create your account?",
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [authDraft, setAuthDraft] = useState<AuthDraft>({
    fullName: '',
    email: '',
    password: '',
  });
  const [suggestedNames, setSuggestedNames] = useState<string[]>([]);
  const [logoDraft, setLogoDraft] = useState<LogoDraft | null>(null);
  const [isCountryModalOpen, setIsCountryModalOpen] = useState(false);
  const [isCustomizingSlug, setIsCustomizingSlug] = useState(false);
  const [returnToSummary, setReturnToSummary] = useState(false);
  const [rejectedSlug, setRejectedSlug] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

  const counterRef = useRef(1);
  const draftOwnerIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const appendMessages = (...items: Omit<OnboardingChatMessage, 'id'>[]) => {
    setMessages((prev) => [
      ...prev,
      ...items.map((item) => {
        counterRef.current += 1;
        return { ...item, id: `${item.role}-${counterRef.current}` };
      }),
    ]);
  };

  const applyStoreWelcomeState = (nextUser: User) => {
    const nextData = buildInitialWebStoreData(nextUser);
    const needsName = !nextData.firstName || !nextData.lastName;
    draftOwnerIdRef.current = nextUser.id;
    setAuthDraft({ fullName: '', email: '', password: '' });
    setUser(nextUser);
    setData(nextData);
    setSuggestedNames([]);
    setLogoDraft(null);
    setIsCustomizingSlug(false);
    setReturnToSummary(false);
    setRejectedSlug(null);
    setStep(needsName ? 'owner_name' : 'country');
    setMessages([
      {
        id: 'store-welcome',
        role: 'assistant',
        text: needsName
          ? "Welcome to Baci! Let's set up your store together. First, what's your full name?"
          : `Welcome to Baci, ${nextData.firstName}! Let's set up your store together. Where is your business based?`,
      },
    ]);
  };

  const enterStoreSetup = (nextUser: User) => {
    const supabase = createClient();
    const hasPreservableDraft =
      Boolean(data.businessName) &&
      (!draftOwnerIdRef.current || draftOwnerIdRef.current === nextUser.id);
    const run = async () => {
      if (await hasCompletedMerchant(supabase, nextUser.id)) {
        window.location.href = '/dashboard';
        return;
      }
      if (hasPreservableDraft) {
        const { firstName, lastName } = extractUserNames(nextUser);
        draftOwnerIdRef.current = nextUser.id;
        setAuthDraft({ fullName: '', email: '', password: '' });
        setUser(nextUser);
        setData((prev) => ({
          ...prev,
          firstName: prev.firstName || firstName,
          lastName: prev.lastName || lastName,
        }));
        setStep('summary');
        appendMessages({
          role: 'assistant',
          text: "You're signed back in! Your store details are still ready — tap Launch my store whenever you're ready.",
        });
        return;
      }
      applyStoreWelcomeState(nextUser);
    };
    void run();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: hydration runs once on mount; applyStoreWelcomeState only calls stable state setters
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    const hydrate = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!active || !authData.user) return;
        const completed = await hasCompletedMerchant(
          supabase,
          authData.user.id
        );
        if (!active) return;
        if (completed) {
          window.location.href = '/dashboard';
          return;
        }
        applyStoreWelcomeState(authData.user);
      } finally {
        if (active) setIsHydrating(false);
      }
    };
    void hydrate();
    return () => {
      active = false;
    };
  }, []);

  const storeCtx = {
    user,
    setUser,
    data,
    setData,
    setStep,
    setSuggestedNames,
    setLogoDraft,
    setRejectedSlug,
    setIsCustomizingSlug,
    setIsBusy,
    setIsLaunching,
    appendMessages,
  };

  const applyStoreTransition = (result: TransitionResult) => {
    if (result.nextData) setData((prev) => ({ ...prev, ...result.nextData }));
    if (result.clearAiArtifacts) {
      setSuggestedNames([]);
      setLogoDraft(null);
    }
    if (result.customizingSlug !== undefined)
      setIsCustomizingSlug(result.customizingSlug);
    if (result.returnToSummary !== undefined)
      setReturnToSummary(result.returnToSummary);
    if (result.messages?.length) appendMessages(...result.messages);
    if (result.nextStep) setStep(result.nextStep);
    if (result.sideEffect?.type === 'open_country_modal') {
      setIsCountryModalOpen(true);
    } else if (result.sideEffect?.type === 'generate_names') {
      void runWebNameSuggestion(result.sideEffect.description, storeCtx);
    } else if (result.sideEffect?.type === 'upload_logo') {
      fileInputRef.current?.click();
    } else if (result.sideEffect?.type === 'generate_logo') {
      void runWebLogoGeneration(storeCtx);
    } else if (result.sideEffect?.type === 'launch_store') {
      void runWebStoreLaunch(storeCtx);
    } else if (result.sideEffect?.type === 'restart' && user) {
      applyStoreWelcomeState(user);
    }
  };

  const authCtx = {
    step,
    authDraft,
    setAuthDraft,
    setStep,
    setIsBusy,
    appendMessages,
    enterStoreSetup,
  };

  return {
    data,
    fileInputRef,
    handleFileUpload: (file: File) => runWebLogoFileUpload(file, storeCtx),
    handleQuickReply: (option: QuickReplyOption) => {
      if (isBusy) return;
      if (step.startsWith('auth_')) {
        void runWebAuthQuickReply(option, authCtx);
        return;
      }
      applyStoreTransition(
        transitionFromQuickReply({
          option,
          data,
          previewLogoUri: logoDraft?.uri ?? null,
          previewColors: logoDraft?.colors ?? null,
          returnToSummary,
          countries: WEB_COUNTRIES,
        })
      );
    },
    handleSelectCountry: (code: string, name?: string) => {
      setIsCountryModalOpen(false);
      applyStoreTransition(transitionFromCountry(code, name, WEB_COUNTRIES));
    },
    handleSendText: () => {
      if (!inputText.trim() || isBusy) return;
      const text = inputText;
      setInputText('');
      if (step.startsWith('auth_')) {
        void runWebAuthTextInput(text, authCtx);
        return;
      }
      applyStoreTransition(
        transitionFromTextInput({
          step: step as OnboardingChatStep,
          rawText: text,
          data,
          countries: WEB_COUNTRIES,
          businessTypes: WEB_BUSINESS_TYPES,
          isCustomizingSlug,
          returnToSummary,
        })
      );
    },
    hasRejectedSlug: Boolean(rejectedSlug && rejectedSlug === data.slug),
    inputText,
    isBusy,
    isCountryModalOpen,
    isCustomizingSlug,
    isHydrating,
    isLaunching,
    logoDraftUri: logoDraft?.uri || data.logoUrl,
    logoPreviewSource: logoDraft?.source ?? null,
    messages,
    setInputText,
    setIsCountryModalOpen,
    step,
    suggestedNames,
    user,
  };
}
