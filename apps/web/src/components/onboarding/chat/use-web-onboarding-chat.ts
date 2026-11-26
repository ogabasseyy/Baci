'use client';

import {
  DEFAULT_BRAND_COLORS,
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

function namesFromUser(user: User): { firstName: string; lastName: string } {
  const meta = user.user_metadata ?? {};
  const full = String(meta.full_name || meta.name || '').trim();
  const parts = full.split(/\s+/).filter(Boolean);
  return {
    firstName: String(meta.first_name || parts[0] || '').trim(),
    lastName: String(meta.last_name || parts.slice(1).join(' ') || '').trim(),
  };
}

function initialStoreData(user: User | null): OnboardingChatData {
  const { firstName, lastName } = user
    ? namesFromUser(user)
    : { firstName: '', lastName: '' };
  return {
    firstName,
    lastName,
    phone: '',
    businessName: '',
    businessType: '',
    otherBusinessType: '',
    country: 'NG',
    slug: '',
    slugIsCustom: false,
    logoUrl: '',
    brandColors: DEFAULT_BRAND_COLORS,
  };
}

export function useWebOnboardingChat() {
  const [user, setUser] = useState<User | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);
  const [step, setStep] = useState<WebChatStep>('auth_choice');
  const [data, setData] = useState<OnboardingChatData>(() =>
    initialStoreData(null)
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

  const enterStoreSetup = (nextUser: User) => {
    const nextData = initialStoreData(nextUser);
    const needsName = !nextData.firstName || !nextData.lastName;
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

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    const hydrate = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!active || !authData.user) return;
        const nextUser = authData.user;
        if (typeof supabase.from === 'function') {
          const { data: existingMerchant } = await supabase
            .from('merchants')
            .select('business_name')
            .eq('user_id', nextUser.id)
            .maybeSingle();
          if (!active) return;
          if (existingMerchant?.business_name) {
            window.location.href = '/dashboard';
            return;
          }
        }
        const nextData = initialStoreData(nextUser);
        const needsName = !nextData.firstName || !nextData.lastName;
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
      enterStoreSetup(user);
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
