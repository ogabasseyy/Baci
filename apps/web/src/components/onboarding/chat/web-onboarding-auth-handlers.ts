import {
  normalizePersonName,
  type OnboardingChatMessage,
  parseFullNameInput,
  type QuickReplyOption,
} from '@baci/shared/onboarding-chat';
import type { User } from '@supabase/supabase-js';
import { sendMagicLink } from '@/app/(platform)/onboarding/actions';
import { createClient } from '@/lib/supabase/client';
import {
  checkPasswordStrength,
  isCommonPassword,
  MIN_ACCEPTABLE_PASSWORD_STRENGTH,
} from '@/lib/utils';
import {
  submitWebEmailPasswordAuth,
  type WebChatStep,
} from './web-onboarding-chat-helpers';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthDraft {
  fullName: string;
  email: string;
  password: string;
}

export interface AuthStepHandlersContext {
  step: WebChatStep;
  authDraft: AuthDraft;
  setAuthDraft: React.Dispatch<React.SetStateAction<AuthDraft>>;
  setStep: (step: WebChatStep) => void;
  setIsBusy: (busy: boolean) => void;
  appendMessages: (...items: Omit<OnboardingChatMessage, 'id'>[]) => void;
  enterStoreSetup: (user: User) => void;
}

export async function runWebAuthQuickReply(
  option: QuickReplyOption,
  ctx: AuthStepHandlersContext
): Promise<void> {
  const { setAuthDraft, setStep, setIsBusy, appendMessages } = ctx;

  if (option.id === 'auth:check_session') {
    setIsBusy(true);
    try {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        ctx.enterStoreSetup(authData.user);
        return;
      }
      appendMessages({
        role: 'assistant',
        text: 'I don\'t see a confirmed session yet. Open the confirmation link in your inbox, then tap "I\'ve confirmed my email" again.',
      });
    } finally {
      setIsBusy(false);
    }
    return;
  }
  if (option.id === 'auth:google') {
    setIsBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });
    if (error) {
      setIsBusy(false);
      appendMessages({
        role: 'system',
        text: 'Could not start Google sign-in right now. Try creating an account with email instead.',
      });
    }
    return;
  }
  if (option.id === 'auth:email') {
    appendMessages(
      { role: 'user', text: option.label },
      { role: 'assistant', text: "Great! What's your full name?" }
    );
    setStep('auth_name');
    return;
  }
  if (option.id === 'auth:magic_link') {
    appendMessages(
      { role: 'user', text: option.label },
      {
        role: 'assistant',
        text: "Enter your email address and I'll send you a one-click sign-in link:",
      }
    );
    setStep('auth_magic_email');
    return;
  }
  if (option.id === 'auth:edit_password') {
    setAuthDraft((prev) => ({ ...prev, password: '' }));
    appendMessages(
      { role: 'user', text: option.label },
      { role: 'assistant', text: 'Enter a new password (8+ characters):' }
    );
    setStep('auth_password');
    return;
  }
  if (option.id === 'auth:edit_email') {
    const isMagicLinkFlow =
      ctx.step === 'auth_check_email' &&
      !ctx.authDraft.fullName &&
      !ctx.authDraft.password;
    appendMessages(
      { role: 'user', text: option.label },
      {
        role: 'assistant',
        text: isMagicLinkFlow
          ? "Enter your email address and I'll send you a one-click sign-in link:"
          : "What's your email address?",
      }
    );
    setStep(isMagicLinkFlow ? 'auth_magic_email' : 'auth_email');
  }
}

export async function runWebAuthTextInput(
  rawText: string,
  ctx: AuthStepHandlersContext
): Promise<void> {
  const {
    step,
    authDraft,
    setAuthDraft,
    setStep,
    setIsBusy,
    appendMessages,
    enterStoreSetup,
  } = ctx;
  const trimmed = rawText.trim();

  if (step === 'auth_choice') {
    if (EMAIL_PATTERN.test(trimmed)) {
      setAuthDraft((prev) => ({ ...prev, email: trimmed.toLowerCase() }));
      appendMessages(
        { role: 'user', text: trimmed },
        { role: 'assistant', text: "Nice! What's your full name?" }
      );
      setStep('auth_name');
      return;
    }
    appendMessages(
      { role: 'user', text: trimmed },
      {
        role: 'assistant',
        text: 'Choose Google, Create account with email, or Magic link above — or type your email address.',
      }
    );
    return;
  }

  if (step === 'auth_name') {
    const normalized = normalizePersonName(trimmed);
    const parsed = parseFullNameInput(normalized);
    if (!parsed) {
      appendMessages(
        { role: 'user', text: trimmed },
        {
          role: 'assistant',
          text: 'Please include both your first and last name (for example, "Ada Okafor").',
        }
      );
      return;
    }
    setAuthDraft((prev) => ({ ...prev, fullName: normalized }));
    appendMessages(
      { role: 'user', text: normalized },
      {
        role: 'assistant',
        text: authDraft.email
          ? `Great to meet you, ${parsed.firstName}! Now create a strong password (8+ characters):`
          : `Great to meet you, ${parsed.firstName}! What's your email address?`,
      }
    );
    setStep(authDraft.email ? 'auth_password' : 'auth_email');
    return;
  }

  if (step === 'auth_email' || step === 'auth_magic_email') {
    const email = trimmed.toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      appendMessages(
        { role: 'user', text: trimmed },
        { role: 'assistant', text: 'Please enter a valid email address.' }
      );
      return;
    }
    if (step === 'auth_magic_email') {
      setIsBusy(true);
      const result = await sendMagicLink(email);
      setIsBusy(false);
      appendMessages(
        { role: 'user', text: email },
        { role: result.success ? 'assistant' : 'system', text: result.message }
      );
      if (result.success) setStep('auth_check_email');
      return;
    }
    setAuthDraft((prev) => ({ ...prev, email }));
    appendMessages(
      { role: 'user', text: email },
      {
        role: 'assistant',
        text: 'Now create a strong password (8+ characters, mix of letters and numbers):',
      }
    );
    setStep('auth_password');
    return;
  }

  if (step === 'auth_password') {
    const masked = '••••••••';
    if (
      rawText.length < 8 ||
      checkPasswordStrength(rawText) < MIN_ACCEPTABLE_PASSWORD_STRENGTH ||
      isCommonPassword(rawText)
    ) {
      appendMessages(
        { role: 'user', text: masked },
        {
          role: 'assistant',
          text: 'Please choose a stronger password (at least 8 characters with letters, numbers, or symbols).',
        }
      );
      return;
    }
    setAuthDraft((prev) => ({ ...prev, password: rawText }));
    appendMessages(
      { role: 'user', text: masked },
      { role: 'assistant', text: 'Re-enter your password to confirm:' }
    );
    setStep('auth_confirm');
    return;
  }

  if (step === 'auth_confirm') {
    const masked = '••••••••';
    if (rawText !== authDraft.password) {
      appendMessages(
        { role: 'user', text: masked },
        {
          role: 'assistant',
          text: "Those passwords didn't match. Try confirming again, or click Change password below.",
        }
      );
      return;
    }
    setIsBusy(true);
    try {
      const outcome = await submitWebEmailPasswordAuth({
        email: authDraft.email,
        password: rawText,
        fullName: authDraft.fullName,
      });
      if (outcome.status === 'authenticated') {
        enterStoreSetup(outcome.user);
        return;
      }
      if (outcome.status === 'existing_wrong_password') {
        setAuthDraft((prev) => ({ ...prev, password: '' }));
        appendMessages(
          { role: 'user', text: masked },
          {
            role: 'system',
            text: `An account for ${authDraft.email} already exists, and that password didn't match. Sign in with Magic link or Google, or use another email.`,
          }
        );
        setStep('auth_choice');
        return;
      }
      if (outcome.status === 'error') {
        appendMessages({ role: 'system', text: outcome.message });
        return;
      }
      appendMessages(
        { role: 'user', text: masked },
        {
          role: 'assistant',
          text: `Almost there! We sent a confirmation link to ${authDraft.email}. Click it to continue setting up your store.`,
        }
      );
      setStep('auth_check_email');
    } finally {
      setIsBusy(false);
    }
  }
}
