/**
 * useSignInForm Hook
 *
 * 2026 Best Practices:
 * - Separation of concerns (logic from UI)
 * - React Hook Form for form management
 * - Zod for validation (manual validation to avoid v4 resolver issues)
 * - Type-safe return values
 * - Testable business logic
 */

import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AccessibilityInfo } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import type { SignInFormData, UseSignInFormReturn } from '../types';
import { getUserFriendlyError, SOCIAL_ERROR_MESSAGES } from '../utils';
import { signInSchema } from '../utils/validation';
import { useHapticFeedback } from './useHapticFeedback';

interface UseSignInFormOptions {
  onSuccess: () => void;
}

/**
 * Run the email/password sign-in request and translate failures into a
 * user-friendly error message. Lives at module scope so the hook body stays
 * free of try/finally + throw statements, which React Compiler cannot lower.
 */
async function signInWithEmailPassword(
  data: SignInFormData
): Promise<string | null> {
  try {
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: data.email.trim().toLowerCase(),
      password: data.password,
    });

    if (loginError) {
      return getUserFriendlyError(loginError);
    }

    return null;
  } catch (err) {
    return getUserFriendlyError(err);
  }
}

/**
 * Custom hook for sign-in form logic
 *
 * Handles:
 * - Form state and validation (via React Hook Form + Zod)
 * - Email/password authentication
 * - Social sign-in (Google, Apple)
 * - Error handling and user feedback
 * - Haptic feedback
 */
export function useSignInForm({
  onSuccess,
}: UseSignInFormOptions): UseSignInFormReturn {
  const { triggerHaptic } = useHapticFeedback();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingSocialSignInRef = useRef(false);
  // State mirror of the ref so the recovery-timeout effect actually re-runs
  // when a social sign-in starts (mutating a ref alone never reschedules it).
  const [pendingSocialSignIn, setPendingSocialSignIn] = useState(false);

  // Auth store methods
  const user = useAuthStore((state) => state.user);
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);
  const signInWithApple = useAuthStore((state) => state.signInWithApple);

  // React Hook Form with manual validation
  const {
    control,
    handleSubmit,
    formState: { errors },
    setValue,
    setError: setFormError,
  } = useForm<SignInFormData>({
    defaultValues: {
      email: '',
      password: '',
    },
    mode: 'onBlur',
  });

  /**
   * Clear the current error state
   */
  const clearError = () => {
    if (error) setError(null);
  };

  // Keep the synchronous ref (read inside the store subscription) and the
  // effect-arming state in lock-step.
  const setPendingSocialSignInBoth = (next: boolean) => {
    pendingSocialSignInRef.current = next;
    setPendingSocialSignIn(next);
  };

  // Recover from a stalled social sign-in if auth state never updates.
  useEffect(() => {
    if (!pendingSocialSignIn || user) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (!pendingSocialSignInRef.current) {
        return;
      }

      pendingSocialSignInRef.current = false;
      setPendingSocialSignIn(false);
      setIsLoading(false);
      setError('Sign-in timed out. Please try again.');
      triggerHaptic('error');
    }, 30000);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [pendingSocialSignIn, triggerHaptic, user]);

  // Finalize a pending social sign-in when the auth store reports a user.
  // Subscribing to the external store (instead of mirroring `user` through an
  // effect dependency) keeps setState inside a subscription callback.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setPendingSocialSignInBoth only writes a ref and state; resubscribing on its per-render identity would churn the auth subscription.
  useEffect(() => {
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (!state.user || !pendingSocialSignInRef.current) {
        return;
      }

      setPendingSocialSignInBoth(false);
      setIsLoading(false);
      triggerHaptic('success');
      onSuccess();
      router.replace('/checkout');
    });

    return unsubscribe;
  }, [onSuccess, triggerHaptic]);

  /**
   * Validate form data with Zod and set field errors
   */
  const validateForm = (data: SignInFormData): boolean => {
    const result = signInSchema.safeParse(data);

    if (!result.success) {
      // Set field-level errors from Zod
      result.error.issues.forEach((issue) => {
        const field = issue.path[0] as keyof SignInFormData;
        if (field) {
          setFormError(field, { message: issue.message });
        }
      });
      triggerHaptic('warning');
      return false;
    }

    return true;
  };

  /**
   * Handle email/password sign-in
   */
  const handleSignIn = handleSubmit(async (data) => {
    // Validate with Zod
    if (!validateForm(data)) {
      return;
    }

    triggerHaptic('light');
    setIsLoading(true);
    setError(null);

    const friendlyError = await signInWithEmailPassword(data);

    if (friendlyError) {
      setError(friendlyError);
      triggerHaptic('error');

      // Announce error to screen readers
      AccessibilityInfo.announceForAccessibility(friendlyError);
    } else {
      triggerHaptic('success');
      onSuccess();
      router.replace('/checkout');
    }

    setIsLoading(false);
  });

  /**
   * Handle Google OAuth sign-in
   */
  const handleGoogleSignIn = async () => {
    triggerHaptic('light');
    setIsLoading(true);
    setError(null);
    setPendingSocialSignInBoth(true);

    try {
      const result = await signInWithGoogle();

      if (!result.success) {
        setPendingSocialSignInBoth(false);
        setIsLoading(false);

        if (result.error && result.error !== SOCIAL_ERROR_MESSAGES.cancelled) {
          setError(result.error);
          triggerHaptic('error');
          AccessibilityInfo.announceForAccessibility(result.error);
        }
      }
    } catch {
      setPendingSocialSignInBoth(false);
      setError(SOCIAL_ERROR_MESSAGES.google);
      triggerHaptic('error');
      AccessibilityInfo.announceForAccessibility(SOCIAL_ERROR_MESSAGES.google);
      setIsLoading(false);
    }
  };

  /**
   * Handle Apple OAuth sign-in
   */
  const handleAppleSignIn = async () => {
    triggerHaptic('light');
    setIsLoading(true);
    setError(null);
    setPendingSocialSignInBoth(true);

    try {
      const result = await signInWithApple();

      if (!result.success) {
        setPendingSocialSignInBoth(false);
        setIsLoading(false);

        if (result.error && result.error !== SOCIAL_ERROR_MESSAGES.cancelled) {
          setError(result.error);
          triggerHaptic('error');
          AccessibilityInfo.announceForAccessibility(result.error);
        }
      }
    } catch {
      setPendingSocialSignInBoth(false);
      setError(SOCIAL_ERROR_MESSAGES.apple);
      triggerHaptic('error');
      AccessibilityInfo.announceForAccessibility(SOCIAL_ERROR_MESSAGES.apple);
      setIsLoading(false);
    }
  };

  /**
   * Navigate to forgot password screen
   */
  const handleForgotPassword = () => {
    triggerHaptic('light');
    router.push('/auth/login?mode=forgot');
  };

  return {
    // Form control
    control,
    errors,
    setValue,

    // State
    isLoading,
    error,

    // Handlers
    handleSignIn,
    handleGoogleSignIn,
    handleAppleSignIn,
    handleForgotPassword,
    clearError,
  };
}
