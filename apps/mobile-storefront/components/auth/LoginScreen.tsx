import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack } from 'expo-router';
import { Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppKeyboardAwareScrollView from '@/components/ui/AppKeyboardAwareScrollView';
import { loginScreenStyles as styles } from './LoginScreen.styles';
import { LoginScreenContent } from './LoginScreenContent';
import { useLoginScreenController } from './useLoginScreenController';

export function LoginScreen() {
  const {
    authMethod,
    colorScheme,
    colors,
    dismissAndNavigate,
    email,
    emailError,
    emailHintGuidance,
    handleAppleSignIn,
    handleBack,
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
  } = useLoginScreenController();

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerLeft: () => (
            <Pressable onPress={handleBack} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />

      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <AppKeyboardAwareScrollView
          style={styles.safeArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
        >
          <LoginScreenContent
            authMethod={authMethod}
            colorScheme={colorScheme}
            colors={colors}
            dismissAndNavigate={dismissAndNavigate}
            email={email}
            emailError={emailError}
            emailHintGuidance={emailHintGuidance}
            handleAppleSignIn={handleAppleSignIn}
            handleContinue={handleContinue}
            handleGoogleSignIn={handleGoogleSignIn}
            handlePasswordSignIn={handlePasswordSignIn}
            handleResendOtp={handleResendOtp}
            isAppleLoading={isAppleLoading}
            isGoogleLoading={isGoogleLoading}
            isLoading={isLoading}
            isMountedRef={isMountedRef}
            isVerifyingRef={isVerifyingRef}
            otp={otp}
            otpError={otpError}
            otpInputRef={otpInputRef}
            password={password}
            passwordError={passwordError}
            setAuthMethod={setAuthMethod}
            setEmail={setEmail}
            setEmailError={setEmailError}
            setOtp={setOtp}
            setOtpError={setOtpError}
            setPassword={setPassword}
            setPasswordError={setPasswordError}
            setShowPassword={setShowPassword}
            setStep={setStep}
            showPassword={showPassword}
            signInWithOtp={signInWithOtp}
            step={step}
            verifyOtp={verifyOtp}
          />
        </AppKeyboardAwareScrollView>
      </SafeAreaView>
    </>
  );
}
