import type { TextInputInstance } from 'react-native';
/**
 * Shared Types for Checkout Identity Components
 *
 * 2026 Best Practices:
 * - Centralized type definitions
 * - Strict TypeScript interfaces
 * - Reusable across all form components
 */

import type { RefObject } from 'react';
import type { Control, FieldErrors, UseFormSetValue } from 'react-hook-form';
import type { ReturnKeyTypeOptions } from 'react-native';

/**
 * Sign-in form data structure
 */
export interface SignInFormData {
  email: string;
  password: string;
}

/**
 * Props for form input components
 */
export interface FormInputProps {
  control: Control<SignInFormData>;
  errors: FieldErrors<SignInFormData>;
  isLoading: boolean;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
}

/**
 * Props for email input component
 */
export interface EmailInputProps extends FormInputProps {
  onClearError?: () => void;
}

/**
 * Props for password input component
 */
export interface PasswordInputProps extends FormInputProps {
  onClearError?: () => void;
  onForgotPassword: () => void;
  inputRef?: RefObject<TextInputInstance | null>;
}

/**
 * Props for submit button component
 */
export interface SubmitButtonProps {
  isLoading: boolean;
  onPress: () => void;
  label?: string;
  loadingLabel?: string;
}

/**
 * Props for error alert component
 */
export interface ErrorAlertProps {
  error: string | null;
}

/**
 * Props for social sign-in buttons
 */
export interface SocialSignInButtonsProps {
  isLoading: boolean;
  onGoogleSignIn: () => void;
  onAppleSignIn: () => void;
}

/**
 * Props for the main SignInForm component
 */
export interface SignInFormProps {
  onSuccess: () => void;
  showSocialButtons?: boolean;
}

/**
 * Return type for useSignInForm hook
 */
export interface UseSignInFormReturn {
  // Form control
  control: Control<SignInFormData>;
  errors: FieldErrors<SignInFormData>;
  setValue: UseFormSetValue<SignInFormData>;

  // State
  isLoading: boolean;
  error: string | null;

  // Handlers
  handleSignIn: () => Promise<void>;
  handleGoogleSignIn: () => Promise<void>;
  handleAppleSignIn: () => Promise<void>;
  handleForgotPassword: () => void;
  clearError: () => void;
}

/**
 * Haptic feedback types
 */
export type HapticType =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'success'
  | 'warning'
  | 'error';
