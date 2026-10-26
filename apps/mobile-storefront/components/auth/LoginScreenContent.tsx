import type { RefObject } from 'react';
import { type TextInput, View } from 'react-native';
import { Logo } from '@/components/ui/Logo';
import type Colors from '@/constants/Colors';
import { type LoginAuthMethod, LoginEmailStep } from './LoginEmailStep';
import { LoginOtpStep } from './LoginOtpStep';
import { LoginPasswordStep } from './LoginPasswordStep';
import { loginScreenStyles as styles } from './LoginScreen.styles';
import { validateLoginEmailInput } from './login-screen-controller.helpers';

type ColorsScheme = (typeof Colors)['light'];
type AuthStep = 'email' | 'otp' | 'password';

interface LoginScreenContentProps {
  authMethod: LoginAuthMethod;
  colorScheme?: string | null;
  colors: ColorsScheme;
  dismissAndNavigate: () => void;
  email: string;
  emailError: string | null;
  handleAppleSignIn: () => Promise<void>;
  handleContinue: () => void;
  handleGoogleSignIn: () => Promise<void>;
  handlePasswordSignIn: () => void;
  handleResendOtp: () => Promise<boolean | undefined>;
  isAppleLoading: boolean;
  isGoogleLoading: boolean;
  isLoading: boolean;
  isMountedRef: RefObject<boolean>;
  isVerifyingRef: RefObject<boolean>;
  otp: string;
  otpError: string | null;
  otpInputRef: RefObject<TextInput | null>;
  password: string;
  passwordError: string | null;
  setAuthMethod: (value: LoginAuthMethod) => void;
  setEmail: (value: string) => void;
  setEmailError: (value: string | null) => void;
  setOtp: (value: string) => void;
  setOtpError: (value: string | null) => void;
  setPassword: (value: string) => void;
  setPasswordError: (value: string | null) => void;
  setShowPassword: (value: boolean) => void;
  setStep: (value: AuthStep) => void;
  showPassword: boolean;
  signInWithOtp: (
    email: string
  ) => Promise<{ error?: string; success: boolean }>;
  step: AuthStep;
  verifyOtp: (
    email: string,
    token: string
  ) => Promise<{ error?: string; success: boolean }>;
}

export function LoginScreenContent({
  authMethod,
  colorScheme,
  colors,
  dismissAndNavigate,
  email,
  emailError,
  handleAppleSignIn,
  handleContinue,
  handleGoogleSignIn,
  handlePasswordSignIn,
  handleResendOtp,
  isAppleLoading,
  isGoogleLoading,
  isLoading,
  isMountedRef,
  isVerifyingRef,
  otp,
  otpError,
  otpInputRef,
  password,
  passwordError,
  setAuthMethod,
  setEmail,
  setEmailError,
  setOtp,
  setOtpError,
  setPassword,
  setPasswordError,
  setShowPassword,
  setStep,
  showPassword,
  signInWithOtp,
  step,
  verifyOtp,
}: LoginScreenContentProps) {
  return (
    <>
      <View style={styles.logoContainer}>
        <Logo
          color={colorScheme === 'dark' ? 'white' : 'black'}
          width={180}
          height={32}
        />
      </View>

      {step === 'email' ? (
        <LoginEmailStep
          authMethod={authMethod}
          colors={colors}
          email={email}
          emailError={emailError}
          isAppleLoading={isAppleLoading}
          isGoogleLoading={isGoogleLoading}
          isLoading={isLoading}
          onAppleSignIn={handleAppleSignIn}
          onContinue={handleContinue}
          onEmailChange={(text) => {
            setEmail(text);
            if (emailError) setEmailError(null);
          }}
          onGoogleSignIn={handleGoogleSignIn}
          onToggleAuthMethod={() => {
            if (isLoading || isGoogleLoading || isAppleLoading) return;
            if (authMethod === 'password') {
              setAuthMethod('otp');
              return;
            }
            const { error, normalizedEmail } = validateLoginEmailInput(email);
            setEmailError(error);
            if (error) return;
            setEmail(normalizedEmail);
            setAuthMethod('password');
            setStep('password');
          }}
        />
      ) : step === 'otp' ? (
        <LoginOtpStep
          colors={colors}
          dismissAndNavigate={dismissAndNavigate}
          email={email}
          isLoading={isLoading}
          isMountedRef={isMountedRef}
          isVerifyingRef={isVerifyingRef}
          onResendOtp={handleResendOtp}
          otp={otp}
          otpError={otpError}
          otpInputRef={otpInputRef}
          setOtp={setOtp}
          setOtpError={setOtpError}
          verifyOtp={verifyOtp}
        />
      ) : (
        <LoginPasswordStep
          colors={colors}
          email={email}
          handlePasswordSignIn={handlePasswordSignIn}
          isLoading={isLoading}
          otpInputRef={otpInputRef}
          password={password}
          passwordError={passwordError}
          setAuthMethod={setAuthMethod}
          setEmailError={setEmailError}
          setPassword={setPassword}
          setPasswordError={setPasswordError}
          setStep={setStep}
          showPassword={showPassword}
          signInWithOtp={signInWithOtp}
          toggleShowPassword={() => setShowPassword(!showPassword)}
        />
      )}
    </>
  );
}
