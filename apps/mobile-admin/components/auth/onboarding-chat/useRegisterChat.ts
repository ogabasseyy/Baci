import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { validatePassword } from '@/lib/password-utils';
import { getEmailError } from '@/lib/sanitize';
import {
  type OnboardingChatMessage,
  parseFullNameInput,
  type QuickReplyOption,
} from './onboarding-chat.types';

export type RegisterChatStep =
  | 'full_name'
  | 'email'
  | 'password'
  | 'confirm_password';

interface RegisterChatData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

function sentenceCaseWord(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

export function useRegisterChat() {
  const router = useRouter();
  const { signUp } = useAuth();
  const submissionLocked = useRef(false);
  const messageCounterRef = useRef(1);

  const [step, setStep] = useState<RegisterChatStep>('full_name');
  const [data, setData] = useState<RegisterChatData>({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
  const [messages, setMessages] = useState<OnboardingChatMessage[]>([
    {
      id: 'register-welcome',
      role: 'assistant',
      text: "Hi! I'm Baci. Let's create your account and set up your store together. First, what's your full name?",
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const appendMessages = (...items: Omit<OnboardingChatMessage, 'id'>[]) => {
    setMessages((previous) => [
      ...previous,
      ...items.map((item) => {
        messageCounterRef.current += 1;
        return { ...item, id: `${item.role}-${messageCounterRef.current}` };
      }),
    ]);
  };

  const submitAccount = async (payload: RegisterChatData) => {
    if (submissionLocked.current) return;
    submissionLocked.current = true;
    setIsSubmitting(true);

    const email = payload.email.trim().toLowerCase();
    const firstName = sentenceCaseWord(payload.firstName);
    const lastName = sentenceCaseWord(payload.lastName);

    try {
      const result = await signUp({
        email,
        password: payload.password,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`,
        signupFlow: 'merchant',
      });

      if (result.error) {
        Alert.alert('Sign Up Failed', result.error);
        appendMessages({ role: 'system', text: result.error });
        return;
      }
      if (result.accountExists) {
        Alert.alert(
          'Account Exists',
          'An account with this email already exists. Please sign in instead.',
          [
            {
              text: 'Sign In',
              onPress: () => router.replace('/(auth)/login'),
            },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
        appendMessages({
          role: 'system',
          text: 'An account with this email already exists. Tap Sign in below or enter a different email.',
        });
        setStep('email');
        return;
      }
      if (result.needsEmailConfirmation) {
        const attemptIdQuery = result.signupAttemptId
          ? `&attemptId=${encodeURIComponent(result.signupAttemptId)}`
          : '';
        router.replace(
          `/(auth)/verify?email=${encodeURIComponent(email)}${attemptIdQuery}&flow=merchant`
        );
        return;
      }
      if (result.sessionEstablished) {
        router.replace('/(auth)/complete-profile');
        return;
      }

      const fallbackError =
        'We could not establish your session. Please try again.';
      Alert.alert('Sign Up Failed', fallbackError);
      appendMessages({ role: 'system', text: fallbackError });
    } catch {
      const networkError =
        'Unable to connect. Please check your internet connection.';
      Alert.alert('Sign Up Failed', networkError);
      appendMessages({ role: 'system', text: networkError });
    } finally {
      submissionLocked.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSendText = () => {
    if (isSubmitting) return;
    const isPasswordStep = step === 'password' || step === 'confirm_password';
    const rawValue = inputText;
    const trimmed = rawValue.trim();
    if (isPasswordStep ? rawValue.length === 0 : trimmed.length === 0) return;

    setInputText('');

    if (step === 'full_name') {
      const parsed = parseFullNameInput(trimmed);
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
      setData((prev) => ({
        ...prev,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
      }));
      appendMessages(
        { role: 'user', text: trimmed },
        {
          role: 'assistant',
          text: `Nice to meet you, ${sentenceCaseWord(parsed.firstName)}! What's your email address?`,
        }
      );
      setStep('email');
      return;
    }

    if (step === 'email') {
      const emailError = getEmailError(trimmed);
      if (emailError) {
        appendMessages(
          { role: 'user', text: trimmed },
          { role: 'system', text: emailError }
        );
        return;
      }
      setData((prev) => ({ ...prev, email: trimmed }));
      appendMessages(
        { role: 'user', text: trimmed },
        {
          role: 'assistant',
          text: 'Great! Now choose a strong password for your account (at least 8 characters with mixed types).',
        }
      );
      setStep('password');
      return;
    }

    if (step === 'password') {
      const check = validatePassword(rawValue, rawValue);
      if (!check.isValid) {
        appendMessages(
          { role: 'user', text: '••••••••' },
          {
            role: 'system',
            text: check.error || 'Please choose a stronger password.',
          }
        );
        return;
      }
      setData((prev) => ({ ...prev, password: rawValue }));
      appendMessages(
        { role: 'user', text: '••••••••' },
        {
          role: 'assistant',
          text: 'Type your password one more time to confirm.',
        }
      );
      setStep('confirm_password');
      return;
    }

    if (step === 'confirm_password') {
      if (rawValue !== data.password) {
        appendMessages(
          { role: 'user', text: '••••••••' },
          {
            role: 'system',
            text: 'Passwords do not match. Please re-enter your password or tap Change password.',
          }
        );
        return;
      }
      appendMessages({ role: 'user', text: '••••••••' });
      void submitAccount(data);
    }
  };

  const handleQuickReply = (option: QuickReplyOption) => {
    if (isSubmitting) return;
    if (option.id === 'sign_in') {
      router.replace('/(auth)/login');
    } else if (option.id === 'edit_name') {
      appendMessages(
        { role: 'user', text: 'Change name' },
        { role: 'assistant', text: "Sure! What's your full name?" }
      );
      setStep('full_name');
    } else if (option.id === 'edit_email') {
      appendMessages(
        { role: 'user', text: 'Change email' },
        { role: 'assistant', text: "No problem — what's your email address?" }
      );
      setStep('email');
    } else if (option.id === 'edit_password') {
      appendMessages(
        { role: 'user', text: 'Change password' },
        { role: 'assistant', text: 'Okay, enter your new password below.' }
      );
      setStep('password');
    }
  };

  const quickReplies: QuickReplyOption[] =
    step === 'full_name'
      ? [
          {
            id: 'sign_in',
            label: 'Already have an account? Sign in',
            variant: 'secondary',
          },
        ]
      : step === 'email'
        ? [
            { id: 'edit_name', label: 'Change name', variant: 'secondary' },
            { id: 'sign_in', label: 'Sign in instead' },
          ]
        : step === 'password'
          ? [{ id: 'edit_email', label: 'Change email', variant: 'secondary' }]
          : [
              {
                id: 'edit_password',
                label: 'Change password',
                variant: 'secondary',
              },
            ];

  return {
    handleQuickReply,
    handleSendText,
    inputText,
    isSubmitting,
    messages,
    quickReplies,
    setInputText,
    showPassword,
    step,
    toggleShowPassword: () => setShowPassword((prev) => !prev),
  };
}
